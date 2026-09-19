/**
 * Shows which Telegram chats have messaged your bot, with the chat id to use as TELEGRAM_CHAT_ID.
 *
 *   pnpm telegram:chats
 *
 * Send your bot any message first (or add it to a group and post there). `pnpm onboard` does the
 * same lookup interactively; this command is for setups without a terminal wizard, such as the
 * GitHub Actions workflow in docs/github-actions.md, where it also writes to the job summary.
 */
import { appendFileSync } from "node:fs";
import { findRepoRoot, loadRuntimeEnv } from "../packages/shared/src/index.js";
import { findTelegramChats, getTelegramBotUsername } from "../packages/notify/src/telegram.js";

async function main(): Promise<void> {
  const env = loadRuntimeEnv(findRepoRoot(process.cwd()) ?? process.cwd());
  if (!env.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather in Telegram and add its token first.");
  }

  const botUsername = await getTelegramBotUsername(env.telegramBotToken);
  const chats = await findTelegramChats(env.telegramBotToken);
  const lines: string[] = [];
  if (!chats.length) {
    lines.push(
      `No recent messages to @${botUsername}. In Telegram, open @${botUsername}, press Start or send any message,`,
      "then run this again within a day (Telegram only keeps recent messages)."
    );
  } else {
    lines.push(`Chats that recently messaged @${botUsername}:`, "");
    for (const chat of chats) {
      lines.push(`- ${chat.name} (${chat.type === "private" ? "private chat" : chat.type}): TELEGRAM_CHAT_ID = ${chat.id}`);
    }
    lines.push("", "Use the id of the chat that should receive the digest.");
  }

  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.map((line) => (line ? `${line}  ` : "")).join("\n")}\n`, "utf8");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
