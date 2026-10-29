# 多账号槽位与账号更换（A / B / C / D / ...）

## 核心原则

- **槽位不等于账号身份。** A/B/C 是本地配置名，实际 ChatGPT 账号由每个槽位的 `CODEX_HOME` 登录状态决定。
- A 为主账号；B/C/D 可独立登录与更换。不同槽位的登录凭据不能复制或共享。
- 使用 SHA-256 派生的账号身份摘要检测更换。仅在本机保存摘要，不打印原始账号 ID、邮箱、Token。
- B/C/D 换号后，旧的五小时状态、成功去重和相关活动快照应失效；防止新账号继承旧账号的“今天已预热”状态。
- 同一个真实账号意外登录到两个槽位时，自动跳过重复身份的第二个槽位，防止重复调用。
- 未登录槽位单独标记 `PENDING_LOGIN`，不会影响已登录槽位的真实请求。

## 在 Windows 上添加 C 或 D

先将仓库根目录的 `config.example.json` 复制成 Git 忽略的 `config.local.json`，并在 `accounts` 中补充槽位。比如：

```json
{
  "timeZone": "Asia/Shanghai",
  "accounts": [
    {"name": "A", "home": ".codex", "enabled": true},
    {"name": "B", "home": ".codex-prewarm-B", "enabled": true},
    {"name": "C", "home": ".codex-prewarm-C", "enabled": true},
    {"name": "D", "home": ".codex-prewarm-D", "enabled": false}
  ]
}
```

相对 `home` 路径以 Windows 用户目录为基准；A 默认对应 `%USERPROFILE%\.codex`，B/C/D 分别使用其它独立文件夹。

C 首次登录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\login.ps1 -Account C
```

B 更换到另一个 ChatGPT 账号：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\login.ps1 -Account B -Replace
```

`-Replace` 只登出所选副账号槽位，不会登出 A。A 不能通过该参数更换。开启 D 时，把 `enabled` 改为 `true`，用 `-Account D` 登录即可。E、F 也遵循同样模式。

**浏览器授权需要用户本人完成。** 不要把 `auth.json`、邮箱、会话令牌或 API Key 写进 Git 仓库。

## 验证

```powershell
npm test
node .\src\morning-real-prewarm.js --dry-run
node .\src\smart-scheduler.js --dry-run
```

- C 未登录前：看到 `PENDING_LOGIN` 是正常情况；不能算作 C 已成功。
- C 登录后：先检查身份与其他槽位是否不同，再执行一次真实 Codex 调用验证，而非只根据计划任务返回码 0 判断。
- 晨间由真实模型请求尝试激活已到期的五小时窗口；白天则依历史活动和窗口状态决定是否再次发起请求。
- 账号更换之后的第一次运行若出现 `ACCOUNT_REPLACED`，说明旧账号的额度状态已清除；这属于保护逻辑。
- 可查看 `logs/晨间真实预激活.log`、`logs/智能调度.log`。

## 为什么某个账号的重置时间会变化？

曾观察到 A 在一条真实成功请求后，五小时刷新时间从 15:40 先后变化为 16:52、18:13。日志只证明**服务器稍后返回了不同的额度状态**，不足以断言原因。其他 Work/Codex 客户端活动、官方自动或已使用的重置、服务端更新等均是需要进一步核实的可能性。

现在白天巡检遇到重置时间变化超过两分钟会记 `RESET_TIME_CHANGED`，包含前后时间、已用百分比，并统一标 `cause=unverified`。**不自动兑换、购买或主动使用额度重置**。

更多分析参见 [历史故障复盘](incident-history.md)。官方对重置时间变化的说明：<https://help.openai.com/en/articles/20001498-how-resets-work-in-codex>。
