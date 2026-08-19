import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadBirthdays } from "./birthday";
import { answerForMessage } from "./commands";
import { requireEnv } from "./env";
import type { ILinkGetUpdatesResponse, ILinkMessage } from "./types";

const BASE = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "0.1.0";
const GET_UPDATES_TIMEOUT_MS = 20_000;
// context_token 约 24h 过期、只有用户发消息才刷新；超过该小时数就主动提醒用户续命。
const DEFAULT_EXPIRY_REMIND_HOURS = 16;
// 运行时状态用于跨次执行复用 context_token/get_updates_buf。
const RUNTIME_FILE = ".runtime/state.json";

const EXPIRY_REMINDER_TEXT = [
  "⚠️ 我已经超过 16 小时没收到你的消息，快要掉线啦～",
  "随便回我一句（比如「在吗」）就能让我继续正常工作 🙏",
].join("\n");

interface UserSession {
  contextToken?: string;
  lastUserMessageAt?: string;
  lastExpiryReminderAt?: string;
}

interface RuntimeState {
  // 多用户：每个微信用户（key = from_user_id / to_user_id）各存一份会话状态。
  users?: Record<string, UserSession>;
  // get_updates_buf 是机器人账号级游标，所有用户共用一份。
  getUpdatesBuf?: string;
  updatedAt?: string;
  // 以下为历史单用户字段，仅用于首次迁移，迁移后不再写入。
  contextToken?: string;
  lastUserMessageAt?: string;
  lastExpiryReminderAt?: string;
}

function generateWechatUin() {
  const randomUint32 = Math.floor(Math.random() * 0xffffffff);
  return Buffer.from(String(randomUint32)).toString("base64");
}

function generateClientId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(text: string) {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getHeaders(token: string) {
  // iLink 对请求头较敏感：AuthorizationType / X-WECHAT-UIN / App-ClientVersion 缺失时，
  // 可能出现 HTTP 200 但消息无法稳定投递。
  return {
    Authorization: `Bearer ${token}`,
    AuthorizationType: "ilink_bot_token",
    "Content-Type": "application/json",
    "X-WECHAT-UIN": generateWechatUin(),
    "iLink-App-Id": "",
    "iLink-App-ClientVersion": "0",
  };
}

async function readRuntimeState(): Promise<RuntimeState> {
  let raw: RuntimeState = {};
  try {
    const file = Bun.file(RUNTIME_FILE);
    if (await file.exists()) {
      raw = (await file.json()) as RuntimeState;
    }
  } catch {
    // state.json 损坏时从空状态重建，靠 migrateState 播种 owner。
  }
  return migrateState(raw);
}

// 老版本 state.json 只存单个 contextToken，首次读到多用户版本时迁成 users 表；
// 全新部署（state.json 不存在）则用 .env 里的 CONTEXT_TOKEN 给 owner 播种。
function migrateState(state: RuntimeState): RuntimeState {
  if (state.users) return state;

  const ownerId = process.env.TO_USER_ID;
  const users: Record<string, UserSession> = {};

  if (ownerId && state.contextToken) {
    users[ownerId] = {
      contextToken: state.contextToken,
      lastUserMessageAt: state.lastUserMessageAt,
      lastExpiryReminderAt: state.lastExpiryReminderAt,
    };
  } else if (ownerId && process.env.CONTEXT_TOKEN) {
    users[ownerId] = { contextToken: process.env.CONTEXT_TOKEN };
  }

  return {
    getUpdatesBuf: state.getUpdatesBuf,
    updatedAt: state.updatedAt,
    users,
  };
}

async function writeRuntimeState(state: RuntimeState) {
  // 先确保目录存在，避免首次运行写文件失败。
  await mkdir(dirname(RUNTIME_FILE), { recursive: true });
  await Bun.write(RUNTIME_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * 拉一次 getupdates，把每个刚发过消息的用户的最新 context_token 写进 users 表。
 * 供每日提醒前调用，尽量刷新到最新 token；失败则沿用已存 token，不阻断后续发送。
 */
export async function refreshUserTokens(): Promise<void> {
  const token = requireEnv("ILINK_TOKEN");
  const state = await readRuntimeState();
  const getUpdatesBuf = state.getUpdatesBuf || "";

  let newGetUpdatesBuf = getUpdatesBuf;
  const users = { ...(state.users ?? {}) };

  try {
    const resp = (await fetch(`${BASE}/ilink/bot/getupdates`, {
      method: "POST",
      headers: getHeaders(token),
      body: JSON.stringify({
        get_updates_buf: getUpdatesBuf,
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      signal: AbortSignal.timeout(GET_UPDATES_TIMEOUT_MS),
    }).then((r) => r.json())) as ILinkGetUpdatesResponse;

    if (resp.get_updates_buf) newGetUpdatesBuf = resp.get_updates_buf;

    for (const msg of resp.msgs ?? []) {
      if (msg.message_type !== 1 || !msg.context_token) continue;
      const prev = users[msg.from_user_id] ?? {};
      users[msg.from_user_id] = {
        contextToken: msg.context_token,
        lastUserMessageAt: new Date(
          msg.create_time_ms ?? Date.now(),
        ).toISOString(),
        lastExpiryReminderAt: prev.lastExpiryReminderAt,
      };
    }
  } catch (error) {
    console.log(
      "refreshUserTokens 拉取失败，沿用已存 token:",
      getErrorMessage(error),
    );
  }

  await writeRuntimeState({
    users,
    getUpdatesBuf: newGetUpdatesBuf,
    updatedAt: new Date().toISOString(),
  });
}

export async function sendMessage(
  toUserId: string,
  contextToken: string,
  text: string,
) {
  const token = requireEnv("ILINK_TOKEN");
  if (!contextToken) throw new Error("缺少 CONTEXT_TOKEN");

  const body = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: generateClientId(),
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [
        {
          type: 1,
          text_item: {
            text,
          },
        },
      ],
    },
    base_info: {
      channel_version: CHANNEL_VERSION,
    },
  };

  const bodyText = JSON.stringify(body);

  const headers = {
    ...getHeaders(token),
    "Content-Length": String(Buffer.byteLength(bodyText, "utf-8")),
  };

  console.log("========== 开始发送微信消息 ==========");
  console.log("发送对象:", toUserId);
  console.log("是否带 context_token:", Boolean(contextToken));
  console.log("client_id:", body.msg.client_id);
  console.log("发送内容:\n");
  console.log(text);
  console.log("====================================");

  const response = await fetch(`${BASE}/ilink/bot/sendmessage`, {
    method: "POST",
    headers,
    body: bodyText,
  });

  const rawText = await response.text();
  const result = safeJsonParse(rawText);

  console.log("HTTP Status:", response.status);
  console.log("原始返回:", rawText || "{}");

  // HTTP 200 仅表示接口调用成功；真正的投递结果仍需看 ret 字段。
  if (!response.ok) {
    throw new Error(`微信消息发送失败：HTTP ${response.status}`);
  }

  if (typeof result === "object" && result !== null) {
    const ret = (result as any).ret;

    // ret=-2 常见于 context_token/会话失效，是最常见的投递失败原因。
    if (ret === -2) {
      throw new Error("微信投递失败：context_token 可能已失效");
    }

    if (ret !== undefined && ret !== 0) {
      throw new Error(`微信投递失败：ret=${ret}`);
    }
  }

  console.log("✅ 微信消息发送成功");
  return result;
}

/**
 * 给所有已绑定（曾给机器人发过消息）的用户发同一条消息，每人用各自最新的 context_token。
 * 某个用户 token 失效只记日志，不影响其他人。返回实际成功发送的人数。
 */
export async function sendToAllUsers(text: string): Promise<number> {
  const state = await readRuntimeState();
  const users = state.users ?? {};
  let sent = 0;

  for (const [userId, sess] of Object.entries(users)) {
    if (!sess.contextToken) continue;
    try {
      await sendMessage(userId, sess.contextToken, text);
      sent++;
    } catch (error) {
      console.error(`发送给 ${userId} 失败:`, getErrorMessage(error));
    }
  }

  return sent;
}

function extractText(msg: ILinkMessage): string | null {
  const item = msg.item_list?.find((it) => it.type === 1);
  return item?.text_item?.text ?? null;
}

/**
 * 「检查并回复」一次性执行：读游标 → getupdates 拉新消息 → 逐条回复 → 写回游标。
 * 供 Windows 任务计划每 1~2 分钟调用一次；游标持久化保证同一条消息不会重复回复。
 */
export async function checkAndReply(): Promise<void> {
  const token = requireEnv("ILINK_TOKEN");
  const state = await readRuntimeState();
  const getUpdatesBuf = state.getUpdatesBuf || "";

  let newGetUpdatesBuf = getUpdatesBuf;
  const users = { ...(state.users ?? {}) };

  let resp: ILinkGetUpdatesResponse;
  try {
    resp = (await fetch(`${BASE}/ilink/bot/getupdates`, {
      method: "POST",
      headers: getHeaders(token),
      body: JSON.stringify({
        get_updates_buf: getUpdatesBuf,
        base_info: {
          channel_version: CHANNEL_VERSION,
        },
      }),
      signal: AbortSignal.timeout(GET_UPDATES_TIMEOUT_MS),
    }).then((r) => r.json())) as ILinkGetUpdatesResponse;
  } catch (error) {
    console.log("getupdates 失败或超时，本轮跳过:", getErrorMessage(error));
    return;
  }

  if (resp.get_updates_buf) newGetUpdatesBuf = resp.get_updates_buf;

  const msgs = resp.msgs ?? [];
  const list = await loadBirthdays();
  let replied = 0;

  for (const msg of msgs) {
    if (msg.message_type !== 1) continue;
    if (!msg.context_token) continue;

    const text = extractText(msg);
    if (!text) continue;

    // 顺手把该用户的最新 context_token / 最后发言时间存进 users 表。
    const prev = users[msg.from_user_id] ?? {};
    users[msg.from_user_id] = {
      contextToken: msg.context_token,
      lastUserMessageAt: new Date(msg.create_time_ms ?? Date.now()).toISOString(),
      lastExpiryReminderAt: prev.lastExpiryReminderAt,
    };

    try {
      const reply = await answerForMessage(text, list);
      await sendMessage(msg.from_user_id, msg.context_token, reply);
      replied++;
    } catch (error) {
      console.error("回复失败:", getErrorMessage(error));
    }
  }

  await writeRuntimeState({
    users,
    getUpdatesBuf: newGetUpdatesBuf,
    updatedAt: new Date().toISOString(),
  });

  console.log(`检查完成：收到 ${msgs.length} 条消息，回复 ${replied} 条`);
}

function expiryRemindThresholdMs(): number {
  const raw = process.env.EXPIRY_REMIND_HOURS;
  const parsed = raw === undefined ? DEFAULT_EXPIRY_REMIND_HOURS : Number(raw);
  const hours =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPIRY_REMIND_HOURS;
  return hours * 60 * 60 * 1000;
}

/**
 * 检查 context_token 是否接近过期，是则给用户发一条「回我一句续命」的提醒。
 * 供云端每 6 小时跑一次；只有用户发消息才能刷新 token，所以用「最后发言时间」计时。
 */
export async function checkExpiry(): Promise<void> {
  const token = requireEnv("ILINK_TOKEN");
  const state = await readRuntimeState();

  const getUpdatesBuf = state.getUpdatesBuf || "";
  let newGetUpdatesBuf = getUpdatesBuf;
  const users = { ...(state.users ?? {}) };

  // 1) 拉最新消息：任何用户刚发过消息，就刷新其 token 并重置计时。
  try {
    const resp = (await fetch(`${BASE}/ilink/bot/getupdates`, {
      method: "POST",
      headers: getHeaders(token),
      body: JSON.stringify({
        get_updates_buf: getUpdatesBuf,
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      signal: AbortSignal.timeout(GET_UPDATES_TIMEOUT_MS),
    }).then((r) => r.json())) as ILinkGetUpdatesResponse;

    if (resp.get_updates_buf) newGetUpdatesBuf = resp.get_updates_buf;

    for (const msg of resp.msgs ?? []) {
      if (msg.message_type !== 1 || !msg.context_token) continue;
      const prev = users[msg.from_user_id] ?? {};
      users[msg.from_user_id] = {
        contextToken: msg.context_token,
        lastUserMessageAt: new Date(
          msg.create_time_ms ?? Date.now(),
        ).toISOString(),
        lastExpiryReminderAt: prev.lastExpiryReminderAt,
      };
    }
  } catch (error) {
    console.log("checkExpiry 拉取消息失败，本轮跳过:", getErrorMessage(error));
    return;
  }

  // 2) 按用户判断是否要发「续命」提醒（超过阈值且本轮尚未提醒过）。
  const threshold = expiryRemindThresholdMs();
  for (const [userId, sess] of Object.entries(users)) {
    const ageMs = sess.lastUserMessageAt
      ? Date.now() - Date.parse(sess.lastUserMessageAt)
      : null;
    const alreadyReminded =
      sess.lastExpiryReminderAt && sess.lastUserMessageAt
        ? Date.parse(sess.lastExpiryReminderAt) >=
          Date.parse(sess.lastUserMessageAt)
        : false;

    if (
      ageMs !== null &&
      ageMs >= threshold &&
      !alreadyReminded &&
      sess.contextToken
    ) {
      try {
        await sendMessage(userId, sess.contextToken, EXPIRY_REMINDER_TEXT);
        users[userId] = {
          ...sess,
          lastExpiryReminderAt: new Date().toISOString(),
        };
        console.log(`已发送过期提醒给 ${userId}`);
      } catch (error) {
        console.error(`发送过期提醒给 ${userId} 失败:`, getErrorMessage(error));
      }
    }
  }

  // 3) 写回状态。
  await writeRuntimeState({
    users,
    getUpdatesBuf: newGetUpdatesBuf,
    updatedAt: new Date().toISOString(),
  });

  console.log(`过期检查完成：共 ${Object.keys(users).length} 个用户`);
}
