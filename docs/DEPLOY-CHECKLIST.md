# 新电脑部署 / 升级前检查清单

适用范围：Windows 10/11 + 官方 Codex CLI + ChatGPT 账号 A/B/C。跨电脑部署时**按顺序执行**，不要直接把旧电脑的 `auth.json`、日志或本地状态文件复制过去。

## 多账号切换时的额外检查

- B/C/D 更换 ChatGPT 登录后，确认新账号身份与 A 及其它槽位不同；应出现状态重新绑定记录，旧额度数据不得继承。
- C 在首次登录前显示 PENDING_LOGIN 是正常的；必须完成浏览器授权才能计入真实预激活。
- 如 A 重置时间发生变化，查看 RESET_TIME_CHANGED 日志并区分服务器状态变更与脚本请求，不能凭时间变化断言原因。

## 1. 系统和依赖

- [ ] Windows 用户已经登录。锁屏通常没关系；**注销、关机、睡眠会影响任务执行**。计划任务默认依赖当前用户交互式会话。
- [ ] 电脑接通电源时不会按空闲时间自动睡眠：用 `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` 查看；不要仅凭远控软件防休眠。
- [ ] `node --version` 至少 20；`codex --version` 可用。
- [ ] 确认运行时实际找到 Codex CLI：`node -e "const r=require('./src/runtime');console.log(r.exe)"`。输出应指向存在的可执行文件。
- [ ] 代理/联网可用。**浏览器能打开网页不等于后台 CLI 能连通**；若使用 PAC 或自动代理脚本，需要额外配置兼容方式。

## 2. 三账号安全与隔离

- [ ] 通过 `scripts/login.ps1 -Account A`、`-Account B`、`-Account C` 分别浏览器授权；每个账号检查 `codex login status`。
- [ ] 核对 A/B/C 分别使用不同的登录目录（默认 `%USERPROFILE%\.codex`、`%USERPROFILE%\.codex-prewarm-B`、`%USERPROFILE%\.codex-prewarm-C`）。
- [ ] **不要**提交/分享 `auth.json`、refresh token、API Key、账号 ID/邮箱等隐私信息。
- [ ] 不使用 `OPENAI_API_KEY` 代替 ChatGPT 登录，以免误用单独计费 API。
- [ ] 不要让新旧两套计划任务同时运行；先检查 `taskschd.msc` 中是否已有同类任务。

## 3. 非消耗额度的代码验收

在仓库根目录：

```powershell
npm test
node .\src\morning-real-prewarm.js --dry-run
node .\src\smart-scheduler.js --dry-run
```

- [ ] `npm test` 全部通过。
- [ ] 晨间 `--dry-run` 表示 **would_submit_real_Codex_turn** 或对应跳过信息；不能据此断言真实额度成功。
- [ ] 读取手动 Windows 系统代理的隐藏启动器经本机测试无黑框。
- [ ] `scripts/install.ps1` 的 Windows 任务触发器可被注册，`Repetition` 在任务 XML 中按期设置。

## 4. 安装任务

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

- [ ] Windows 计划任务库出现 `Codex-Prewarm-Morning`、`Codex-Prewarm-SmartPoll`、`Codex-Prewarm-OnLogin`。
- [ ] **晨间**：05:30，十五分钟间隔，约五个半小时补试窗口。
- [ ] **白天**：08:00–23:00，每十分钟巡检；不是每十分钟都消耗模型额度。
- [ ] **登录恢复**：用户登录后延迟启动。
- [ ] 任务 Action 指向本机仓库中的 `wscript.exe` 和脚本路径；如重命名仓库文件夹，需重新安装/更新任务。
- [ ] 任务配置没有意外启动一个可见的 PowerShell 控制台窗口。

## 5. 一次真实请求验收（会消耗正常 Codex 额度）

完成上面检查后，给每个账号分别执行一次真实小请求。**不要只看 Windows 返回码 0**。

- [ ] A 有 `REQUEST_OK`，并记录 `turn.completed`、回复 `OK`、Token。
- [ ] B 有自己独立的 `REQUEST_OK`；不能将 A 的成功算作 B 的成功。
- [ ] C 有自己独立的 `REQUEST_OK` 和后续重置时间核验；不能用 A/B 的成功或 C 的 `--dry-run` 代替。
- [ ] 对照请求前窗口是否已到期。请求后仅出现 `REQUEST_OK`，**不等于**开启新五小时窗口。
- [ ] 若旧窗口已结束，额度的 `resetsAt` 在多次只读查询中保持固定，而不是每次变成“现在+五小时”。
- [ ] 任务重复运行时，已完成账号应跳过，不能每轮都再次发出请求。
- [ ] 第二天 05:30（首次真实无人值守）检查 `logs/晨间真实预激活.log` 和 A/B/C 三个账号的状态；真正的跨夜稳定性只有通过这次检查才能确认。

## 6. 看到异常时按日志定位

| 现象/关键词 | 优先检查 |
|---|---|
| 计划任务没运行 | 电脑是否睡眠/关机/注销，当前用户是否登录，任务是否启用 |
| 计划任务返回 0，但无 `REQUEST_OK` | `SKIP` 原因及是否根本没提交模型请求 |
| `tokens_increased` 导致晨间跳过 | **错误旧逻辑**；晨间应该运行专用 `morning-real-prewarm.js` |
| `resetsAt` 每次查询都往后漂移 | 可能是尚未开始的窗口；不要把一次读数当作新窗口 |
| `REQUEST_FAILED`、重连 | 登录状态、网络、代理端口、Codex CLI 版本 |
| `Reading additional input from stdin` | Codex 的子进程 stdin 必须关闭 |
| 返回 `OK` 却被认定失败 | 事件、退出码的判断要使用一致的 Node `--json` 规则 |
| 每十分钟闪黑框 | 是否仍直接通过任务计划程序启动 PowerShell 而不是隐藏 Node |
| 安装时报 Interval 不可写 | 检查使用 XML `Repetition` 配置的最新安装脚本 |
| 新机器隐藏启动器返回码 3 | `node-path.txt` 对应 Node 路径、CR/LF 去除、文件是否存在 |
| 周额度已耗尽 | 等待官方额度恢复；本项目不能绕过或增加额度 |

## 7. 推送 GitHub 前的隐私检查

```powershell
git status --short
git diff --cached --name-only
git diff --cached --check
git ls-files
```

确认不包含 `auth.json`、`config.local.json`、`node-path.txt`、`logs/` 或历史私人配置。不要使用 `git add .` 来一次性上传全部运行目录。GitHub 官方建议显式暂存并在提交前检查变更。

完整问题根因见 [incident-history.md](incident-history.md)。本清单和自动化测试都不是 100% 成功保证：实际服务端额度限制、登录、代理与电脑状态都可能变化。
