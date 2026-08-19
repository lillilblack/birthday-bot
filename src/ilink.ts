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

interface RuntimeState {
  contextToken?: string;
  getUpdatesBuf?: string;
  updatedAt?: string;
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

function isTimeoutError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "TimeoutError"
  );
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

function pickLatestContextMessage(msgs: ILinkMessage[], toUserId: string) {
  // 只取目标用户最近的一条文本消息，避免历史消息里的旧 context_token 污染会话。
  return msgs
    .filter((msg) => {
      return (
        msg.message_type === 1 &&
        msg.from_user_id === toUserId &&
        msg.context_token
      );
    })
    .sort((a, b) => {
      return (b.create_time_ms ?? 0) - (a.create_time_ms ?? 0);
    })[0];
}

async function readRuntimeState(): Promise<RuntimeState> {
  try {
    const file = Bun.file(RUNTIME_FILE);

    if (!(await file.exists())) return {};

    return (await file.json()) as RuntimeState;
  } catch {
    return {};
  }
}

async function writeRuntimeState(state: RuntimeState) {
  // 先确保目录存在，避免首次运行写文件失败。
  await mkdir(dirname(RUNTIME_FILE), { recursive: true });
  await Bun.write(RUNTIME_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export async function fetchLatestContextToken() {
  const token = requireEnv("ILINK_TOKEN");
  const toUserId = requireEnv("TO_USER_ID");
  const runtimeState = await readRuntimeState();

  // 优先使用缓存状态，其次回退到环境变量中的初始 token。
  // context_token 不是永久有效，必须持续刷新和回退。
  const oldContextToken = runtimeState.contextToken || process.env.CONTEXT_TOKEN;
  // get_updates_buf 是增量游标；每次从空值开始会重复读历史消息。
  const getUpdatesBuf = runtimeState.getUpdatesBuf || "";

  const headers = getHeaders(token);

  try {
    console.log("========== 尝试获取最新 context_token ==========");

    const resp = (await fetch(`${BASE}/ilink/bot/getupdates`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        get_updates_buf: getUpdatesBuf,
        base_info: {
          channel_version: CHANNEL_VERSION,
        },
      }),
      signal: AbortSignal.timeout(GET_UPDATES_TIMEOUT_MS),
    }).then((r) => r.json())) as ILinkGetUpdatesResponse;

    console.log("getupdates 返回:");
    console.log(JSON.stringify(resp, null, 2));

    const msgs = resp.msgs ?? [];
    const latestMsg = pickLatestContextMessage(msgs, toUserId);
    const latestContextToken = latestMsg?.context_token || oldContextToken;
    const latestGetUpdatesBuf = resp.get_updates_buf || getUpdatesBuf;
    // 有新消息时记录用户最后发言时间，作为 token 过期计时起点。
    const lastUserMessageAt = latestMsg
      ? new Date(latestMsg.create_time_ms ?? Date.now()).toISOString()
      : runtimeState.lastUserMessageAt;

    // 无论是否有新消息，都更新游标与最近可用 token，保证下次增量拉取连续。
    await writeRuntimeState({
      contextToken: latestContextToken,
      getUpdatesBuf: latestGetUpdatesBuf,
      lastUserMessageAt,
      lastExpiryReminderAt: runtimeState.lastExpiryReminderAt,
      updatedAt: new Date().toISOString(),
    });

    if (!latestContextToken) {
      throw new Error("没有可用的 CONTEXT_TOKEN，请先给 Bot 发一条消息并初始化");
    }

    if (!latestMsg?.context_token) {
      console.log("没有新消息，继续使用缓存/Secrets 中的 context_token");
      return latestContextToken;
    }

    console.log("✅ 获取到新的 context_token，已写入 cache state");
    return latestContextToken;
  } catch (error: unknown) {
    if (isTimeoutError(error)) {
      console.log("getupdates 超时，使用缓存/Secrets 中的 context_token");
    } else {
      console.log("getupdates 失败，使用缓存/Secrets 中的 context_token");
      console.log(getErrorMessage(error));
    }

    // 没有任何可用 token 时直接失败，提示用户先做一次绑定初始化。
    if (!oldContextToken) {
      throw new Error("没有可用的 CONTEXT_TOKEN，请先给 Bot 发一条消息并初始化");
    }

    return oldContextToken;
  }
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

export async function sendToWechat(text: string, contextToken: string) {
  const toUserId = requireEnv("TO_USER_ID");
  return sendMessage(toUserId, contextToken, text);
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
  let latestContextToken = state.contextToken;

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

    try {
      const reply = await answerForMessage(text, list);
      await sendMessage(msg.from_user_id, msg.context_token, reply);
      replied++;
    } catch (error) {
      console.error("回复失败:", getErrorMessage(error));
    }

    latestContextToken = msg.context_token;
  }

  await writeRuntimeState({
    contextToken: latestContextToken,
    getUpdatesBuf: newGetUpdatesBuf,
    lastUserMessageAt: state.lastUserMessageAt,
    lastExpiryReminderAt: state.lastExpiryReminderAt,
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
  const toUserId = requireEnv("TO_USER_ID");
  const state = await readRuntimeState();

  const getUpdatesBuf = state.getUpdatesBuf || "";
  let newGetUpdatesBuf = getUpdatesBuf;
  let latestContextToken = state.contextToken;
  let lastUserMessageAt = state.lastUserMessageAt;
  let lastExpiryReminderAt = state.lastExpiryReminderAt;

  // 1) 拉最新消息：若用户刚发过消息，就刷新 token 并重置计时。
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

    let newestMessageTime: number | null = null;
    for (const msg of resp.msgs ?? []) {
      if (msg.message_type !== 1) continue;
      if (!msg.context_token) continue;
      if (msg.from_user_id !== toUserId) continue;

      const t = msg.create_time_ms ?? Date.now();
      if (newestMessageTime === null || t > newestMessageTime) {
        newestMessageTime = t;
      }
      latestContextToken = msg.context_token;
    }

    if (newestMessageTime !== null) {
      lastUserMessageAt = new Date(newestMessageTime).toISOString();
    }
  } catch (error) {
    console.log("checkExpiry 拉取消息失败，本轮跳过:", getErrorMessage(error));
    return;
  }

  // 2) 判断是否需要提醒（距离上次发言超过阈值，且本轮尚未提醒过）。
  const ageMs = lastUserMessageAt
    ? Date.now() - Date.parse(lastUserMessageAt)
    : null;
  const alreadyReminded =
    lastExpiryReminderAt && lastUserMessageAt
      ? Date.parse(lastExpiryReminderAt) >= Date.parse(lastUserMessageAt)
      : false;

  if (
    ageMs !== null &&
    ageMs >= expiryRemindThresholdMs() &&
    !alreadyReminded &&
    latestContextToken
  ) {
    try {
      await sendMessage(toUserId, latestContextToken, EXPIRY_REMINDER_TEXT);
      lastExpiryReminderAt = new Date().toISOString();
      console.log("已发送过期提醒");
    } catch (error) {
      console.error("发送过期提醒失败:", getErrorMessage(error));
    }
  }

  // 3) 写回状态。
  await writeRuntimeState({
    contextToken: latestContextToken,
    getUpdatesBuf: newGetUpdatesBuf,
    lastUserMessageAt,
    lastExpiryReminderAt,
    updatedAt: new Date().toISOString(),
  });

  console.log(
    `过期检查完成：最后发言 ${lastUserMessageAt ?? "未知"}，上次提醒 ${lastExpiryReminderAt ?? "无"}`,
  );
}
