import { checkExpiry } from "./ilink";

// 一次性入口：供云端定时任务每 6 小时调用，检查 context_token 是否接近过期。
checkExpiry().catch((err) => {
  console.error(err);
  process.exit(1);
});
