import {
  buildBirthdayGreetingMessage,
  getTodayBirthdayPeople,
  loadBirthdays,
} from "./birthday";
import { fetchLatestContextToken, sendToWechat } from "./ilink";
import type { FamilyMember } from "./types";

/**
 * 主流程：每天 00:00 触发，把当天生日队员的固定祝福文案发到微信。
 */
async function main() {
  const birthdays = await loadBirthdays();
  const todayPeople = getTodayBirthdayPeople(birthdays as FamilyMember[]);

  // 只在有人生日时才发消息；没人生日就静默退出，避免每天凌晨打扰。
  if (!todayPeople.length) {
    console.log("今天没有人生日，跳过发送");
    return;
  }

  console.log(
    `今天生日的人：${todayPeople.map((p) => p.name).join("、")}`,
  );

  // 每次发送前先刷新 context_token；失败时会回退到缓存/环境变量中的旧值。
  const contextToken = await fetchLatestContextToken();
  const message = buildBirthdayGreetingMessage(todayPeople);

  await sendToWechat(message, contextToken);

  console.log("生日祝福发送成功");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
