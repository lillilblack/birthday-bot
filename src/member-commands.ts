import { parseDay, parseMonth } from "./chinese-number";
import { loadBirthdays } from "./birthday";
import { persistMember } from "./store";
import type { FamilyMember } from "./types";

const ADD_RE = /^(添加|新增|增加|录入|加)\s*生日/;
const MODIFY_RE = /^(修改|更改|更正|更新|修正|改)\s*生日/;
const TYPE_RE = /(阳历|农历|公历|阴历|新历|旧历|国历|solar|lunar)/i;

const TYPE_LABEL: Record<FamilyMember["birthdayType"], string> = {
  solar: "阳历",
  lunar: "农历",
};

export function isAddIntent(t: string) {
  return ADD_RE.test(t);
}

export function isModifyIntent(t: string) {
  return MODIFY_RE.test(t);
}

function parseType(raw: string): "solar" | "lunar" | null {
  const t = raw.trim().toLowerCase();
  if (["solar", "阳历", "公历", "新历", "国历"].includes(t)) return "solar";
  if (["lunar", "农历", "阴历", "旧历"].includes(t)) return "lunar";
  return null;
}

// 从 s[i] 起读一个「数字 token」：连续阿拉伯数字，或连续中文数字字符。
function readNumberToken(
  s: string,
  i: number,
): { token: string; next: number } | null {
  if (i >= s.length) return null;
  const arabic = /^[0-9]+/.exec(s.slice(i));
  if (arabic) return { token: arabic[0], next: i + arabic[0].length };
  const chinese = /^[零一二两三四五六七八九十廿卅初正冬腊]+/.exec(s.slice(i));
  if (chinese) return { token: chinese[0], next: i + chinese[0].length };
  return null;
}

interface ParsedPayload {
  name: string;
  type: "solar" | "lunar";
  month: number;
  day: number;
  relation: string | null;
}

// 把「姓名 历法 月 日 [关系]」解析成结构化数据。
// 例：王小明 阳历 3 月 15 日 / 王小明 农历 二月初五 队友 / 王小明 阳历 8 31。
function parsePayload(
  payload: string,
): { payload: ParsedPayload } | { error: string } {
  const m = TYPE_RE.exec(payload);
  if (!m) {
    return {
      error:
        "没看懂，需要写清历法。格式：添加生日 王小明 阳历 3 月 15 日（或 农历 二月十五）",
    };
  }

  const name = payload.slice(0, m.index).trim();
  const typeRaw = m[1];
  const afterType = payload.slice(m.index + m[1].length);

  if (!name) {
    return { error: "没找到姓名。格式：添加生日 王小明 阳历 3 月 15 日" };
  }

  const type = parseType(typeRaw);
  if (!type) {
    return { error: `历法「${typeRaw}」不认识，用「阳历」或「农历」` };
  }

  // 解析「月 日」以及可选的关系。
  const s = afterType.trim();
  let i = 0;
  const skipWs = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };

  const mTok = readNumberToken(s, i);
  if (!mTok) {
    return { error: "没找到月份。格式：阳历 3 月 15 日 / 农历 二月十五" };
  }
  const month = parseMonth(mTok.token);
  if (month === null) {
    return { error: `月份「${mTok.token}」不对，应在 1~12 之间` };
  }
  i = mTok.next;

  skipWs();
  if (s[i] === "月") i++;
  skipWs();

  const dTok = readNumberToken(s, i);
  if (!dTok) {
    return { error: "没找到日期。格式：阳历 3 月 15 日 / 农历 二月十五" };
  }
  const day = parseDay(dTok.token, type === "lunar");
  if (day === null) {
    const max = type === "lunar" ? 30 : 31;
    return {
      error: `日期「${dTok.token}」不对，${TYPE_LABEL[type]}应在 1~${max} 之间`,
    };
  }
  i = dTok.next;

  skipWs();
  if (s[i] === "日") i++;
  skipWs();

  const relation = s.slice(i).trim();
  return {
    payload: { name, type, month, day, relation: relation || null },
  };
}

// 生成新 id：取现有数字 id 最大值 + 1，形如 m059。
function nextId(list: FamilyMember[]): string {
  const maxNum = list.reduce((max, m) => {
    const n = Number.parseInt((m.id ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `m${String(maxNum + 1).padStart(3, "0")}`;
}

export async function handleAdd(text: string): Promise<string> {
  const payloadText = text.replace(ADD_RE, "");
  const parsed = parsePayload(payloadText);
  if ("error" in parsed) return `❌ ${parsed.error}`;

  const p = parsed.payload;
  const list = await loadBirthdays();

  if (list.some((m) => m.name === p.name)) {
    return `⚠️ 「${p.name}」已经在名单里了。要改日期请用「修改生日 ${p.name} …」`;
  }

  const member: FamilyMember = {
    id: nextId(list),
    parentId: null,
    spouseId: null,
    familyName: p.name.charAt(0),
    generation: 1,
    name: p.name,
    relation: p.relation ?? "队友",
    birthYear: null,
    birthdayType: p.type,
    birthMonth: p.month,
    birthDay: p.day,
  };

  await persistMember(member);
  return [
    `✅ 已添加：${member.name}（${TYPE_LABEL[member.birthdayType]}${member.birthMonth}月${member.birthDay}日，关系：${member.relation}）`,
    "下次提醒和查询会自动包含 TA。",
  ].join("\n");
}

export async function handleModify(text: string): Promise<string> {
  const payloadText = text.replace(MODIFY_RE, "");
  const parsed = parsePayload(payloadText);
  if ("error" in parsed) return `❌ ${parsed.error}`;

  const p = parsed.payload;
  const list = await loadBirthdays();
  const target = list.find((m) => m.name === p.name);
  if (!target) {
    return `❌ 名单里没有「${p.name}」。回复「生日列表」查看都有谁，或「添加生日」新增。`;
  }

  const updated: FamilyMember = {
    ...target,
    familyName: p.name.charAt(0),
    name: p.name,
    relation: p.relation ?? target.relation,
    birthdayType: p.type,
    birthMonth: p.month,
    birthDay: p.day,
  };

  await persistMember(updated);
  return [
    `✅ 已更新：${updated.name} 的生日改为 ${TYPE_LABEL[updated.birthdayType]}${updated.birthMonth}月${updated.birthDay}日（关系：${updated.relation}）`,
  ].join("\n");
}
