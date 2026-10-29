# 历史故障复盘与防回归清单

本记录来自 Windows 双账号 Codex 额度预激活项目的多轮真实调试。公开仓库只保留可复现的症状、原因、修复和验收标准，不上传私人日志、账号标识、令牌或原机器的绝对路径。

> **核心原则：Windows 任务运行成功 ≠ Codex 模型调用成功 ≠ 新五小时窗口已开启。**

OpenAI 的五小时窗口在上一窗口结束后，由**下一条真实 Work/Codex 请求**启动；读取使用量本身不触发新窗口。窗口开始前显示的下次重置时间也可能是估计值而发生变化。请参考 [官方用量机制](https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex) 与 [重置时间说明](https://help.openai.com/en/articles/20001498-how-resets-work-in-codex)。

## 一、历史问题总表

| 编号 | 用户看到的现象 | 实际原因 | 修复方式 | 防止再次发生 |
|---|---|---|---|---|
| 01 | 离开电脑后无法预激活 | 交流电下曾设置空闲 10 分钟睡眠；远控软件偶尔阻止睡眠，不可靠 | 关闭交流电自动睡眠，使用 Windows 任务计划程序 | 用 `powercfg` 和实际日志核对；**锁屏与注销不同** |
| 02 | 第二个账号可能用到了 A 的额度 | 两次 Codex 登录复用默认 `CODEX_HOME` | 给每个账号独立目录；分别登录 ChatGPT | 本地核对账号身份不同，不记录邮箱/账号 ID |
| 03 | Codex 卡住 `Reading additional input from stdin` | 后台进程继承了未关闭的标准输入 | Node 启动 Codex 使用 `stdio:['ignore','pipe','pipe']`（旧 PowerShell 用空文件） | 真正完成请求而非只检查进程是否存在 |
| 04 | 额度查询正常，模型请求连续重连 | 浏览器使用 Windows 系统代理，CLI 没继承 `HTTP_PROXY` 和 `HTTPS_PROXY` | 隐藏启动器读取手动系统代理，传入子进程 | 真实执行一次极简模型调用；PAC/自动代理需另行处理 |
| 05 | Codex 已回复 `OK` 却被记成失败 | PowerShell `Start-Process` 退出码不可靠，结果解析不一致 | 改成 Node 子进程与 `--json` 事件判定 | `turn.completed`、回复 `OK`、Token 用量、退出状态共同确认 |
| 06 | 每十分钟自动检查，但窗口过期后始终不启动 | `usedPercent=0` 时接口给出的 `resetsAt≈现在+5小时` 可能持续向后漂移；旧逻辑把它当成活跃窗口 | 白天判断结合历史窗口、相邻额度快照和真实请求结果 | 覆盖滚动时间与固定时间的回归测试 |
| 07 | 次日 05:30 计划任务返回 0，A/B 实际都没预激活 | `tokens_increased` 反映历史累计用量增长，**不能证明凌晨已开启新窗口** | 晨间改用专用 `morning-real-prewarm.js`，每天分别真实请求，不用累计 Token/预测重置时间拦截 | 确认两账号均有实际 `REQUEST_OK` 和窗口验证 |
| 08 | 每十分钟弹黑色控制台窗口 | 计划任务直接启动 PowerShell；首次隐藏方式仍可能闪窗 | `wscript.exe` 隐藏启动 Node，再使用 `windowsHide:true` 启动 Codex | 自然触发不闪窗，日志仍正常 |
| 09 | Windows 计划任务显示成功，业务仍失败 | 任务包装器正常结束、账号却被 `SKIP` | 任务、模型完成和新窗口三层分别记日志 | 检查业务日志，**不能只看 Task Scheduler 返回码 0** |
| 10 | 新电脑上 Node/Codex 找不到 | 旧代码硬编码原机器 exe 路径 | `src/runtime.js` 加本地配置，`node-path.txt` Git 忽略 | 换机器后实际验证路径 |
| 11 | GitHub 克隆/推送超时 | Git 没有使用 Windows 浏览器代理 | Git 命令显式采用当前可用代理 | `git ls-remote` + 远端 SHA 验证；不在源码写死端口 |
| 12 | 安装计划任务时报 Repetition 属性不可写 | 部分 Windows 上 `New-ScheduledTaskTrigger` 没有直接可写的 Interval/Duration | 先注册任务，再修改 Task Scheduler XML 中的 Repetition 节点 | 用临时任务实测 `PT15M`/`PT5H30M` 后删除 |
| 13 | 仓库隐藏启动器返回错误码 3 | 读取 `node-path.txt` 末尾 CR/LF，Node 路径检查失败 | VBS 读取后去除换行符 | 隐藏启动器 `--dry-run` 退出码 0 |
| 14 | 整理桌面后担心计划任务路径失效 | 计划任务 Action 引用原运行目录的绝对路径 | 保留旧运行路径，在独立文件夹另做 Git 源码副本 | 检查 Action 绝对路径仍存在 |
| 15 | 公开仓库可能泄露凭据 | 工作目录混有 `auth.json`、日志、账号状态、个人路径和历史备份 | 逐项暂存源码；`.gitignore`、敏感信息扫描 | `git diff --cached` / `git ls-files` 无私有文件 |

### 16. C 账号登录脚本误用 PowerShell 只读变量 `$HOME`（2026-10-29）

**现象：** 双击 C 登录批处理时，`login-slot.ps1` 报错“无法覆盖变量 HOME，因为该变量为只读变量或常量”，浏览器登录未开始。

**根因：** PowerShell 变量名大小写不敏感，局部变量 `$home` 与系统自动变量 `$HOME` 冲突；仓库的 `scripts/login.ps1` 和一份旧登录脚本也存在此问题。

**修复：** 将三份脚本涉及的 `$home` 全部重命名为 `$slotHome`，新增 `-ValidateOnly` 非交互预检查，并加入防回归测试防止再次引入 `$home`、`$host` 或 `$pid` 命名冲突。

**验收：** C 槽位预检查输出 `PREFLIGHT_OK`，独立登录目录正确；不启动浏览器、不读取或覆盖其他账号凭据。完成真实浏览器授权后，再通过额度查询与真实请求验收 C。

Microsoft 参考：[PowerShell 自动变量](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables)、[变量大小写规则](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_case-sensitivity)。

## 二、两个最关键的误判

### A. 「当前时间 + 五小时」并不总是活跃窗口

历史现象：上一轮真实窗口已到期，但只读额度接口返回的 `resetsAt` 每隔十分钟也向后移动十分钟。旧脚本使用 `if (resetsAt > now) SKIP`，就会永远误判成窗口尚未结束。

**教训**：单次 `resetsAt` 是不充分的证据；针对白天启用相邻只读快照、历史实际窗口结束时间与真实 Codex 执行记录的综合判断。浮动时间规则来自实机观察，是**启发式**而不是正式 API 保证。

### B. 05:30 的 `tokens_increased` 再次导致漏触发

即使修了浮动 `resetsAt`，下一天 05:30 两账号又被 `tokens_increased` 跳过。它只表示跨时间段累计 Token 增长，可能是上一窗口的请求数据延后刷新，不能当作新窗口的证据。

**最终策略**：晨间专用脚本每天为 A 和 B 各实际提交一条请求（如果当天已完成则不重发）；白天仍使用智能活动检测。真实请求后再分别验证窗口时间。晨间与白天职责分开，不互相替代。

## 三、必须区分的四个结果

1. **任务触发**：Windows 最后执行时间有记录；不代表真的消耗模型额度。
2. **`REQUEST_OK`**：`turn.completed` + 回复 `OK` + 输入 Token + 成功退出，代表该账号真实完成模型请求。
3. **`WINDOW_VERIFIED`**：重置时间经两次只读查询保持固定；需要结合请求前旧窗口是否结束，判断是**新窗口**还是使用**现有窗口**。
4. **双账号通过**：必须分别核验 A 与 B，任何一个失败不能写“两个账号成功”。

晨间程序失败会按账号重试、设上限和冷却。每周额度耗尽、网络异常、用户注销或 Windows 休眠时，代码无法创造额外权限或绕过限制。锁屏（用户仍登录）通常不阻止任务运行。

## 四、对应代码、测试与验证边界

- `src/morning-real-prewarm.js`：解决晨间误判，按账号单独执行/记录/重试。
- `src/smart-scheduler.js`：白天智能巡检；成功后避免重复调用。
- `src/window-detection.js`：浮动五小时重置时间的启发式检测。
- `tests/test-window-detection.js`、`tests/test-morning-regression.js`：额度窗口逻辑测试。
- `tests/test-regression-contracts.js`：关键源码/任务脚本约束检查。它是**静态保护**，并不能代替在线联机测试。
- `scripts/install.ps1`：XML 形式的 Windows 任务重复间隔配置。
- `scripts/run-node-hidden.vbs`：无黑框后台启动、手动系统代理读取。

**所有回归测试通过仍不等于明天 05:30 一定成功**。每次部署/升级应按 [DEPLOY-CHECKLIST.md](DEPLOY-CHECKLIST.md) 做实机验收。

## 参考

- [OpenAI：Work 与 Codex 五小时和每周用量机制](https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex)
- [OpenAI：为什么重置时间可能改变](https://help.openai.com/en/articles/20001498-how-resets-work-in-codex)
- [Microsoft：任务计划程序 Repetition XML](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-repetition-triggerbasetype-element)
- [GitHub：避免泄露仓库敏感数据](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
