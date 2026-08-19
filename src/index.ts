import {
  getTodayBirthdayPeople,
  getTomorrowBirthdayPeople,
  loadBirthdays,
} from "./birthday";
import { fetchLatestContextToken, sendToWechat } from "./ilink";
import type { FamilyMember } from "./types";

/**
 * 主流程：每天 00:00 触发，做两件事：
 * 1. 今天是 XX 生日 → 提醒「今天是XX生日，记得祝生日快乐」；
 * 2. 明天是 XX 生日 → 提醒「明天是XX生日，记得提前准备」（即生日前一天提醒）。
 * 两者都无则静默跳过，不打扰。
 */
async function main() {
  const birthdays = (await loadBirthdays()) as FamilyMember[];
  const todayPeople = getTodayBirthdayPeople(birthdays);
  const tomorrowPeople = getTomorrowBirthdayPeople(birthdays);

  if (todayPeople.length === 0 && tomorrowPeople.length === 0) {
    console.log("今天和明天都没有人生日，跳过发送");
    return;
  }

  const lines: string[] = [];
  if (todayPeople.length > 0) {
    lines.push(
      `🎂 今天是${todayPeople.map((p) => p.name).join("、")}生日，记得祝生日快乐！`,
    );
  }
  if (tomorrowPeople.length > 0) {
    lines.push(
      `⏰ 明天是${tomorrowPeople.map((p) => p.name).join("、")}生日，记得提前准备祝福～`,
    );
  }

  const message = lines.join("\n");
  console.log(message);

  const contextToken = await fetchLatestContextToken();
  await sendToWechat(message, contextToken);

  console.log("生日提醒发送成功");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
