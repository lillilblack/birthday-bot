# 辩论队生日提醒机器人（birthday-bot）

Bun + TypeScript，走 iLink 微信协议。**纯提醒 + 查询 + 微信自助增改生日，无 AI/大模型。**
项目根：`e:\大学\大学生活\辩论队\birthday-bot-master`

## 功能
- 每天 00:00（北京时间）发「今天/明天谁生日」提醒；无人生日则静默跳过。
- 微信指令：查询生日 + 自助新增/修改生日。
- 支持阳历（solar）+ 农历（lunar）。
- **单用户**：iLink bot 是「个人机器人」，一人一 bot，微信里没有分享入口，无法多人扫码加入（结论见 docs/多用户接入调研结论.md）。代码里的 `users` 表/群发逻辑是官方多用户 API 模型，但实际只有 owner 一个用户，降级为单人使用。

## 运行命令（bun）
| 命令 | 作用 |
|---|---|
| `bun run start` | 每日提醒（今天+明天），任务计划每天 00:00 调 |
| `bun run check` | 轮询新消息并回复（一次性），任务计划每 1~2 分钟调 |
| `bun run check-expiry` | token 快过期时发「续命」提醒，云端每 6h 调 |
| `bun run listen` | 常驻循环轮询（2s），秒回测试用 |
| `bun run add-member "姓名" solar\|lunar 月 日 [关系]` | CLI 新增（写 birthdays.json） |
| `bun run get-token` | 获取微信凭证 |

## 凭证 / 数据
- `.env`：`ILINK_TOKEN` / `TO_USER_ID` / `CONTEXT_TOKEN`（.gitignore 忽略）—— 这三项是 owner（扫码绑定人）的凭证，仅用于首次启动播种
- `birthdays.json`：主名单（58 人：阳历 51 + 农历 7）；`birthdays.example.json` 是格式模板；`birthdays.schema.json` 是字段规范
- `.runtime/`：运行时状态 —— `state.json`（`users` 表：每个用户各自的 `context_token`/最后发言时间；`get_updates_buf` 账号级游标）、`birthdays-overlay.json`（微信自助增改的成员）
- 云端（GitHub Actions）：用 `BIRTHDAYS_JSON` Secret 替代 birthdays.json；`.runtime/` 随 Actions Cache 持久化

## 微信指令（src/commands.ts + src/member-commands.ts）
- 查询：`今天谁生日` / `还有几天有生日`（最近谁生日）/ `XX 的生日` / `生日列表` / `帮助`
- 自助增改：
  - `添加生日 王小明 阳历 3 月 15 日`
  - `添加生日 李贝芊 农历 二月十五 队友`
  - `修改生日 王小明 农历 二月初五`
- 其余消息 → 兜底提示

## 项目结构
- `src/index.ts` 每日提醒主流程；`src/check.ts` 轮询回复入口；`src/check-expiry.ts` 过期提醒入口；`src/listener.ts` 常驻轮询
- `src/ilink.ts` iLink 协议、token 管理、sendMessage / checkAndReply / checkExpiry
- `src/birthday.ts` 生日计算（阳/农历、今天/明天/最近）+ `loadBirthdays()`（主名单 + overlay 按 id 合并）
- `src/commands.ts` 指令路由 + 查询回复
- `src/member-commands.ts` 自助增改（添加/修改生日）
- `src/chinese-number.ts` 中文/阿拉伯数字解析（正/冬/腊、初X、廿X、卅）
- `src/store.ts` overlay 读写（.runtime/birthdays-overlay.json）
- `src/types.ts` FamilyMember / ILink 类型；`src/env.ts` requireEnv
- `scripts/add-member.ts` CLI 新增；`scripts/get-token.ts` 获取凭证
- `.github/workflows/` birthday.yml（每日）/ check.yml（每 5 分钟）/ expiry-reminder.yml（每 6h）
- `docs/` 网页版（方案 2）：`index.html`（页面）+ `lunar.mjs`（农历换算）+ `roster.json`（网页名单）；部署说明见 docs/网页部署教程.md

## 关键逻辑
- 名单读取：`loadBirthdays()` = 主名单（env 或 birthdays.json）+ overlay 合并，微信自助增改只写 overlay、**不覆盖主名单**。
- 提醒（start）与查询（check）都调 `loadBirthdays()`，新增即时生效、无需重启。
- context_token 约 24h 过期，只有用户发消息才刷新；**按人**记录在 `users` 表里，超 16h 未发言发「续命」提醒（每人单独判断）。
- 每日提醒（start）先 `refreshUserTokens()` 刷新一遍 token，再 `sendToAllUsers()` 群发给所有绑定过的人；某个人 token 失效只记日志、不拖累其他人。
- 老 `state.json` 单 `contextToken` 字段首次读取时自动迁成 `users` 表（`migrateState`）；全新部署用 `.env` 的 `CONTEXT_TOKEN` 给 owner 播种。

## 坑
- **多用户不可行**：iLink bot 一人一 bot、微信里无分享入口，无法「一个二维码全队扫」（结论见 docs/多用户接入调研结论.md）。`users` 表/群发逻辑保留但实际只有 owner 一人。全队查生日已做成网页版（`docs/`：index.html + lunar.mjs + roster.json，链接 https://lillilblack.github.io/birthday-bot/，部署说明见 docs/网页部署教程.md）。
- 本机 Claude Code 的 shell 里没有 bun/node，需用户在自己终端跑；用户用 cmd.exe，跨盘 cd 要加 `/d`。
- 绑定需 iOS 微信扫码；`BirthdayBotDaily` 任务计划要 PC 在 00:00 开机（StartWhenAvailable，错过会补发）。
- iLink 是否认国外 IP 未验证；私有仓库免费 2000 分钟/月，check 频率建议改 `*/15`。
