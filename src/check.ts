import { checkAndReply } from "./ilink";

// 一次性入口：供 Windows 任务计划每 1~2 分钟调用一次。
checkAndReply().catch((err) => {
  console.error(err);
  process.exit(1);
});
