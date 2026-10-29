# Codex Quota Prewarm

面向 Windows 的 **Codex 多账号五小时额度窗口预激活**工具。使用 OpenAI Codex CLI（命令行工具）为不同 ChatGPT 账号分别执行少量真实请求，并通过额度接口核对重置时间。

> 非 OpenAI 官方项目。预激活**不会增加额度、绕过限额或强制重置正在进行的五小时窗口**；只是让上一窗口结束后下一次真实请求尽早发生。每次请求会使用正常的 Codex 额度。

## 历史故障与避免重犯（建议安装前先读）

这个项目曾经过多轮 Windows 实机调试。最严重的故障是：**05:30 的 Windows 任务显示成功，但脚本因为误判累计 Token 增长而没有真正发送模型请求**；此外还遇到浮动重置时间、代理、黑框闪现、stdin 等待、双账号混淆和新电脑安装兼容问题。

- **[历史故障复盘：15 类错误的现象、原因、修复和验收标准](docs/incident-history.md)**。
- **[新电脑部署 / 升级检查清单](docs/DEPLOY-CHECKLIST.md)**：从登录到任务执行、额度验证、回退与隐私检查。
- **防回归测试**：`npm test` 运行窗口判断与源码约束；GitHub Actions 在 Windows 上自动执行离线测试和 PowerShell 语法检查。
- **切勿误判成功**：`Task Scheduler 返回 0`、`REQUEST_OK`、`WINDOW_VERIFIED` 和**真正新窗口开启**是四个不同的条件。

这些检查不能替代一次真实请求和下一次无人值守执行验证。

## 账号管理上位机（本地网页 MVP）

现在提供一个本机可运行的账户管理页面：查看各账号登录邮箱、五小时/每周额度与重置时间，新增或停用副账号，在页面里发起浏览器授权，切换当前操作槽位，以及打开对应账号的独立 Codex 终端。

- 访问地址：http://127.0.0.1:38671/
- 手动启动：npm run dashboard
- 安装登录后自动启动：powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install-dashboard.ps1
- 说明及限制：[dashboard/README.md](dashboard/README.md)

上位机只监听本机回环地址，不能直接远程使用；**选择上位机当前操作账号，不会切换已经打开的 Codex 桌面应用或 VS Code 扩展**。原来的定时预激活任务保持独立运行。

## 功能

- **多账号隔离**：A/B 默认使用不同的 `CODEX_HOME`，不会通过覆盖默认账号登录文件来切换。
- **晨间预激活**：每天本地时间 05:30 发起真实请求；失败时每 15 分钟补试，直到约 11:00（每账号每天最多 3 次真实尝试）。
- **智能巡检**：08:00–23:00 每 10 分钟只读检查；旧窗口结束且近期有使用活动时才尝试新请求。
- **额度验证**：需要实际 `turn.completed`、回复 `OK`、输入 Token 和固定的下一次重置时间。
- **后台启动**：Windows 任务计划程序 + `wscript.exe`，通常不会出现控制台黑框。
- **本地状态与日志**：所有运行状态保存在被 Git 忽略的 `logs/` 中。
- **自动读取 Windows 系统手动代理**：支持 ProxyServer；PAC/自动代理脚本、公司网络和特殊代理方案需要自行验证。

## 运行前提

Windows 10/11，**Node.js 20+**、Git（仅用于克隆或更新），并安装官方 Codex CLI：

```powershell
npm install -g @openai/codex
codex --version
```

请确保两套 ChatGPT 账号均有可用 Codex 权限。此项目 **不需要 API Key**，也不使用单独计费的 API。脚本会在子进程中清除 `OPENAI_API_KEY`。

## 安装（Windows PowerShell）

```powershell
git clone https://github.com/tfsvh69-blip/codex-quota-prewarm.git
cd codex-quota-prewarm

# 第一次使用：分别完成 A 和 B 的浏览器 ChatGPT 登录
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\login.ps1 -Account A
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\login.ps1 -Account B

# 先不消耗额度，做模拟检查
node .\src\morning-real-prewarm.js --dry-run
node .\src\smart-scheduler.js --dry-run
npm test

# 创建 Windows 计划任务
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

若已经用本项目安装过任务，需要更新时使用 `-ReplaceExistingTasks`。安装过程会创建本机 `node-path.txt` 用于让隐藏启动器找到 Node.js，它不会提交到 GitHub。

**注意**：本机可能已经存在旧版 `Codex-双账号-*` 任务。迁移时应先停用旧版任务，避免两套任务同时执行。此安装脚本仅管理以 `Codex-Prewarm-` 命名的新任务，不会自动删除别人的任务。

### 创建的 Windows 任务

| 名称 | 触发条件 |
| --- | --- |
| `Codex-Prewarm-Morning` | 每天 05:30，之后每 15 分钟，持续约 5.5 小时 |
| `Codex-Prewarm-SmartPoll` | 每天 08:00–23:00，每 10 分钟 |
| `Codex-Prewarm-OnLogin` | Windows 用户登录后，延迟约 90 秒 |

运行环境是当前 Windows 用户的**交互式登录会话**。锁屏但保持登录通常可以正常执行；**关机、休眠或注销后无法保证按时执行**。必须确保网络以及代理程序可以在无人值守时使用。

## 验证是否真的成功

查看 `logs/晨间真实预激活.log` 和 `logs/智能调度.log`，不能只看任务计划程序的退出码：

- `REQUEST_OK`：实际模型完成（仍不单独证明开启了新窗口）。
- `WINDOW_VERIFIED`：晨间脚本读取到固定的服务器重置时间。
- `AFTER: resetAt=...`：白天巡检完成真实请求后的额度时间。
- `SKIP`：旧窗口仍在进行、已成功预热，或当前不满足条件。
- `REQUEST_FAILED`：请检查账户登录、代理和服务状态。

Windows 任务的“返回码 0”只能表明任务程序退出成功，不意味着新额度一定已经启动。

## 自定义

默认 A 使用 `%USERPROFILE%\.codex`，B 使用 `%USERPROFILE%\.codex-prewarm-B`。如需其他目录或 Codex CLI 路径，可复制 `config.example.json` 为 `config.local.json` 后根据实际情况修改。**本地配置不会上传到 GitHub**。也可以通过 `CODEX_BIN` 环境变量指定官方 `codex.exe` 路径。

建议在设置完 `config.local.json` 后验证 `node -e "console.log(require('./src/runtime').exe)"` 的输出指向存在的可执行文件。

## 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

这只移除本项目注册的三个计划任务，**不会删除账号登录文件、日志或源代码**。

## 项目结构

```src/
  morning-real-prewarm.js    # 每天首次真实请求、按天去重和验证
  smart-scheduler.js         # 活动感知的额度窗口巡检
  window-detection.js        # 判断浮动重置时间（启发式算法）
  runtime.js                 # 本机路径与账号配置
scripts/
  install.ps1 / uninstall.ps1 / login.ps1
  run-node-hidden.vbs        # Windows 隐藏启动与系统代理识别
tests/
  test-window-detection.js
  test-morning-regression.js
config.example.json
```

## 隐私与安全

不得上传 `auth.json`、refresh token、API Key、`logs/`、`config.local.json`、`node-path.txt`。仓库内的 `.gitignore` 已配置常见排除项，但仍应在提交前人工检查 `git diff --cached`。参见 <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository>。

## 多账号动态管理

现在支持 A 固定主账号、B/C/D 等可替换的登录槽位，换号后会清除旧账户的历史额度状态，避免重复登录同一个账号。详见 [多账号槽位与账号更换](docs/MULTI_ACCOUNT.md)。

## 已知限制

- 额度接口及其内部字段可能随官方 Codex CLI 更新而变化，无法承诺所有版本都兼容。
- “浮动重置时间”的识别来自实机观察，不是 OpenAI 官方保证的 API 语义。
- 如果每周额度或五小时额度确实耗尽、请求被限制，脚本无法绕过。
- 当前主要在 Windows 11 + 双 ChatGPT 登录环境验证；尚未完成全新电脑的端到端安装测试。
- 不提供自动注册、购买额度，也不接触其他账户的登录凭据。

欢迎提交 issue、复现记录和改进建议（请先移除日志中的个人信息）。
