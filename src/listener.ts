import { checkAndReply } from "./ilink";

const POLL_INTERVAL_MS = 2000;

async function main() {
  console.log("开始监听消息（每 2 秒轮询一次，Ctrl+C 退出）...");

  while (true) {
    try {
      await checkAndReply();
    } catch (err) {
      console.error("轮询出错:", err);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
