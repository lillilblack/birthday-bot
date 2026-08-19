import {
  getDaysUntilBirthday,
  getTodayBirthdayPeople,
  getUpcomingBirthdays,
} from "./birthday";
import {
  handleAdd,
  handleModify,
  isAddIntent,
  isModifyIntent,
} from "./member-commands";
import type { FamilyMember } from "./types";

const TYPE_LABEL: Record<FamilyMember["birthdayType"], string> = {
  solar: "阳历",
  lunar: "农历",
};

// 未命中任何指令时的兜底回复。
const FALLBACK_TEXT = "🤖 我是生日助手，能提醒、查询和管理生日。回复「帮助」查看能问什么。";

function helpText(): string {
  return [
    "🤖 生日提醒助手",
    "",
    "生日查询：",
    "- 今天谁生日",
    "- 还有几天有生日 / 最近谁生日",
    "- XX 的生日（如：王嘉仪的生日）",
    "- 生日列表",
    "",
    "自助管理：",
    "- 添加生日 王小明 阳历 3 月 15 日",
    "- 添加生日 王小明 农历 二月十五 队友",
    "- 修改生日 王小明 农历 二月初五",
    "",
    "回复「帮助」可再次查看本说明",
  ].join("\n");
}

function answerToday(list: FamilyMember[]): string {
  const today = getTodayBirthdayPeople(list);

  if (today.length === 0) {
    return "🎂 今天没有人生日。";
  }

  const lines = today.map(
    (p) =>
      `- ${p.name}（${TYPE_LABEL[p.birthdayType]}${p.birthMonth}月${p.birthDay}日）`,
  );

  return ["🎂 今天生日：", ...lines].join("\n");
}

function answerUpcoming(list: FamilyMember[]): string {
  const upcoming = getUpcomingBirthdays(list, 3);

  if (upcoming.length === 0) {
    return "⚠️ 没有可用的生日数据。";
  }

  const lines = upcoming.map((u) => {
    const m = u.member;
    const daysText = u.days === 0 ? "就是今天" : `还有 ${u.days} 天`;
    return `- ${m.name}（${TYPE_LABEL[m.birthdayType]}${m.birthMonth}月${m.birthDay}日），${daysText}`;
  });

  return ["🎂 最近的生日：", ...lines].join("\n");
}

function answerList(list: FamilyMember[]): string {
  const groups = new Map<string, string[]>();

  for (const m of list) {
    const label =
      m.birthdayType === "solar" ? `${m.birthMonth}月` : `农历${m.birthMonth}月`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(`${m.name}(${m.birthDay}日)`);
  }

  const keys = [...groups.keys()].sort((a, b) => {
    const lunarA = a.startsWith("农历");
    const lunarB = b.startsWith("农历");
    if (lunarA !== lunarB) return lunarA ? 1 : -1;
    const numA = parseInt(a.replace("农历", "").replace("月", ""), 10);
    const numB = parseInt(b.replace("农历", "").replace("月", ""), 10);
    return numA - numB;
  });

  const lines = keys.map((k) => `${k}：${groups.get(k)!.join("、")}`);

  return ["🎂 生日列表：", ...lines].join("\n");
}

// 消息里出现队员名字时精确命中本人。
function findMentionedMembers(text: string, list: FamilyMember[]): FamilyMember[] {
  return list.filter((m) => text.includes(m.name));
}

function answerPersonBirthday(person: FamilyMember): string {
  const typeLabel = TYPE_LABEL[person.birthdayType];
  const days = getDaysUntilBirthday(person);
  const dayText =
    days === null ? "" : days === 0 ? "（就是今天🎉）" : `（还有 ${days} 天）`;
  return `🎂 ${person.name} 的生日：${typeLabel}${person.birthMonth}月${person.birthDay}日${dayText}`;
}

// —— 意图判断：只有「明确生日相关」的短语才走本地精确逻辑，
//    避免「今天天气怎么样」这类普通问题被误判成生日查询。——

function isTodayIntent(t: string) {
  return /(今天|今日)/.test(t) && /(生日|寿星)/.test(t);
}

function isUpcomingIntent(t: string) {
  return (
    /(最近|还有几天|几天|下一个|下次|接下来|即将)/.test(t) &&
    /(生日|寿星|谁)/.test(t)
  );
}

function isListIntent(t: string) {
  return /(列表|名单|所有|全部)/.test(t) && /(生日|寿星|队员)/.test(t);
}

function isHelpIntent(t: string) {
  return /(帮助|怎么用|能干什么|有什么功能|指令)/i.test(t);
}

// 消息里同时出现队员名字 + 生日/日期类词 → 问某人生日。
function personBirthdayMatch(
  text: string,
  list: FamilyMember[],
): FamilyMember | null {
  if (!/(生日|几号|哪天|什么时候|何时|寿星)/.test(text)) return null;
  return findMentionedMembers(text, list)[0] ?? null;
}

/**
 * 根据用户发来的消息文本，返回要回复的内容。
 * 命中生日指令走本地精确逻辑；否则返回简短兜底提示。
 */
export async function answerForMessage(
  text: string,
  list: FamilyMember[],
): Promise<string> {
  const t = text.trim();

  // 自助管理（新增/修改）优先于查询，避免「添加/修改生日 XX」被当成查生日。
  if (isAddIntent(t)) return handleAdd(t);
  if (isModifyIntent(t)) return handleModify(t);

  // 命中具体队员名字的指令优先走本地精确逻辑（查生日）。
  const birthdayPerson = personBirthdayMatch(t, list);
  if (birthdayPerson) return answerPersonBirthday(birthdayPerson);

  if (isTodayIntent(t)) return answerToday(list);
  if (isUpcomingIntent(t)) return answerUpcoming(list);
  if (isListIntent(t)) return answerList(list);
  if (isHelpIntent(t)) return helpText();

  return FALLBACK_TEXT;
}
