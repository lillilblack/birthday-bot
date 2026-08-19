# Birthday Bot（辩论队生日提醒）

一个走微信的生日提醒机器人：每天 00:00 自动提醒「今天 / 明天谁生日」，也可以在微信里查某人的生日和整份名单。**纯提醒 + 查询，不含 AI。**

## 功能

- 每天 00:00（北京时间）自动发一条提醒：
  - 今天是 XX 生日 → 「🎂 今天是XX生日，记得祝生日快乐！」
  - 明天是 XX 生日 → 「⏰ 明天是XX生日，记得提前准备祝福～」（即生日前一天提醒）
  - 两者都没有 → 静默跳过，不打扰
- 支持阳历 + 农历生日
- 微信里发指令查询（需要机器人回复功能在运行）：

| 你说 | 机器人回 |
|---|---|
| 今天谁生日 | 今天生日的人 |
| 还有几天有生日 / 最近谁生日 | 最近 3 个生日 |
| 王嘉仪的生日 | 只回她一个人的生日 + 还有几天 |
| 生日列表 | 整份名单按月份分组 |
| 添加生日 王小明 阳历 3 月 15 日 | 新增一名队员 |
| 修改生日 王小明 农历 二月初五 | 改已有队员的生日 |
| 帮助 | 指令说明 |

## 运行方式

两种，任选其一（也可同时）：

1. **本地 Windows**：任务计划每天 00:00 跑 `bun run start` 发提醒；每 1~2 分钟跑 `bun run check` 回复查询。
2. **云端 GitHub Actions**：见 [docs/云端部署教程.md](docs/云端部署教程.md)，关机也能跑。

## 快速开始（本地）

```bash
# 1. 装依赖（需要 Bun）
bun install

# 2. 配置 .env（ILINK_TOKEN / TO_USER_ID / CONTEXT_TOKEN）

# 3. 准备名单
cp birthdays.example.json birthdays.json   # 然后改成你自己的名单

# 4. 手动发一次提醒
bun run start
```

## 新增 / 修改成员

三种方式：

1. **微信自助**（推荐，不用碰代码）：直接在微信里给机器人发指令
   - 添加：`添加生日 王小明 阳历 3 月 15 日`（阳历），`添加生日 李贝芊 农历 二月十五 队友`（农历，可带关系）
   - 修改：`修改生日 王小明 农历 二月初五`
   - 历法支持写「阳历/公历/solar」和「农历/阴历/lunar」；月日支持阿拉伯数字或中文数字（如「二月十五」）。

2. **命令行新增**：

   ```bash
   bun run add-member "王嘉仪" solar 8 31        # 阳历 8 月 31 日
   bun run add-member "李贝芊" lunar 2 28 队友    # 农历二月廿八
   ```

3. **直接编辑 `birthdays.json`**：按 `birthdays.example.json` 的格式加一条即可。

微信自助新增/修改的成员会存到 `.runtime/birthdays-overlay.json`（与主名单自动合并），不覆盖 `birthdays.json`。云端部署时 `.runtime/` 随 GitHub Actions Cache 一起保存，微信新增也会被保留。

新增后无需重启，下次提醒和查询会自动包含 TA。

## 必要的环境变量 / Secrets

- `ILINK_TOKEN`：iLink Bot Token
- `TO_USER_ID`：要发送到的用户 ID
- `CONTEXT_TOKEN`：会话 Token（首次需先给机器人发一条消息拿到）
- `BIRTHDAYS_JSON`（云端用）：整个 `birthdays.json` 的内容

## 重要：Context Token 有效期

`CONTEXT_TOKEN` 约 24 小时过期，只有「你主动给机器人发消息」时才会刷新。所以每隔一两天给机器人随便发一句（比如「在吗」），否则它会断线收不到提醒。

## 项目结构

- [src/index.ts](src/index.ts)：每日提醒主流程（今天 + 明天）
- [src/birthday.ts](src/birthday.ts)：生日计算（阳历/农历、今天/明天/最近、还有几天）
- [src/commands.ts](src/commands.ts)：微信指令解析与回复
- [src/ilink.ts](src/ilink.ts)：iLink 微信协议、token 管理
- [scripts/add-member.ts](scripts/add-member.ts)：新增成员 CLI
- [scripts/get-token.ts](scripts/get-token.ts)：获取凭证 CLI
- [birthdays.example.json](birthdays.example.json)：名单示例
- [birthdays.schema.json](birthdays.schema.json)：名单字段规范
