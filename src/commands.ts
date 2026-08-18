import { getTodayBirthdayPeople, getUpcomingBirthdays } from "./birthday";
import type { FamilyMember } from "./types";

const TYPE_LABEL: Record<FamilyMember["birthdayType"], string> = {
  solar: "阳历",
  lunar: "农历",
};

function helpText(): string {
  return [
    "🤖 生日提醒机器人",
    "",
    "你可以发这些指令给我：",
    "- 还有几天有生日 / 最近谁生日",
    "- 今天谁生日",
    "- 生日列表 / 所有生日",
    "- 帮助",
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

/**
 * 根据用户发来的消息文本，返回要回复的内容。
 */
export function answerForMessage(text: string, list: FamilyMember[]): string {
  const t = text.trim();

  if (/今天/.test(t)) {
    return answerToday(list);
  }

  if (/(还有几天|几天|最近|下一个|下次|接下来)/.test(t)) {
    return answerUpcoming(list);
  }

  if (/(列表|所有|全部|名单)/.test(t)) {
    return answerList(list);
  }

  return helpText();
}
