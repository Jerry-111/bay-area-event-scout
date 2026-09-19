import { loadRuntimeEnv, requireRealModeValue } from "@event-scout/shared";
import { sendTelegramMessage } from "./telegram.js";

const env = loadRuntimeEnv();
const botToken = requireRealModeValue(env.telegramBotToken, "TELEGRAM_BOT_TOKEN", { ...env, mockMode: false });
const chatId = requireRealModeValue(env.telegramChatId, "TELEGRAM_CHAT_ID", { ...env, mockMode: false });

await sendTelegramMessage(
  {
    botToken,
    chatId,
    text: `Bay Event Scout Telegram test\n${new Date().toISOString()}`
  },
  { ...env, mockMode: false }
);

console.log("Telegram test message sent.");
