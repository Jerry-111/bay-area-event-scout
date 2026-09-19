import { createLogger, fetchWithTimeout, getLogFormat, type AppEnv, type EventCandidate } from "@event-scout/shared";
import { appendFileSync } from "node:fs";
import { digestFromEnv, toMarkdownDigest, toPlainTextDigest } from "./digest.js";

const logger = createLogger("notify");

export interface TelegramSendResult {
  delivered: boolean;
  mock: boolean;
  message: string;
}

export async function sendDigest(
  events: EventCandidate[],
  env: AppEnv
): Promise<TelegramSendResult> {
  const message = digestFromEnv(events, env);
  writeGithubJobSummary(message);

  if (env.mockMode || !env.telegramBotToken || !env.telegramChatId) {
    const reason = env.mockMode ? "mock mode" : "no Telegram bot configured";
    const digest = toPlainTextDigest(message);
    if (getLogFormat() === "pretty") {
      console.log(`[notify] ${events.length} event${events.length === 1 ? "" : "s"} in this digest (${reason}, printing here instead):`);
      console.log(digest);
    } else {
      // Keep JSON logs one object per line for Trigger.dev, CI, and log pipelines.
      logger.info("digest not sent to Telegram", { reason, events: events.length, digest });
    }
    return { delivered: false, mock: env.mockMode, message };
  }

  await sendTelegramMessage(
    {
      botToken: env.telegramBotToken,
      chatId: env.telegramChatId,
      text: message
    },
    env
  );

  return { delivered: true, mock: false, message };
}

export async function sendTelegramMessage(
  input: { botToken: string; chatId: string; text: string },
  env?: AppEnv
): Promise<void> {
  if (env?.mockMode) return;

  const response = await fetchWithTimeout(
    fetch,
    `https://api.telegram.org/bot${encodeURIComponent(input.botToken)}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    },
    env?.timeouts.telegramMs ?? 15_000,
    "Telegram sendMessage"
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed with HTTP ${response.status}: ${body}`);
  }
}

export interface TelegramChat {
  id: string;
  type: string;
  /** A person's name, or a group or channel title. */
  name: string;
}

interface TelegramApiReply<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramChatPayload {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramUpdate {
  message?: { chat: TelegramChatPayload };
  edited_message?: { chat: TelegramChatPayload };
  channel_post?: { chat: TelegramChatPayload };
  my_chat_member?: { chat: TelegramChatPayload };
}

/** Checks a bot token and returns the bot's @username. Throws with Telegram's reason when the token is wrong. */
export async function getTelegramBotUsername(botToken: string, timeoutMs = 15_000): Promise<string> {
  const reply = await callTelegram<{ username?: string }>(botToken, "getMe", timeoutMs);
  return reply.username ?? "your bot";
}

/**
 * Lists the chats that have recently messaged the bot (or added it to a group), newest first, so
 * setup can offer "send your bot a message, then pick your chat" instead of asking people to read
 * a chat id out of raw JSON. Telegram only keeps these updates for about a day.
 */
export async function findTelegramChats(botToken: string, timeoutMs = 15_000): Promise<TelegramChat[]> {
  const updates = await callTelegram<TelegramUpdate[]>(botToken, "getUpdates", timeoutMs);
  const chats = new Map<string, TelegramChat>();
  for (const update of [...updates].reverse()) {
    const chat = (update.message ?? update.edited_message ?? update.channel_post ?? update.my_chat_member)?.chat;
    if (!chat || chats.has(String(chat.id))) continue;
    const personName = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    chats.set(String(chat.id), {
      id: String(chat.id),
      type: chat.type,
      name: chat.title ?? (personName || (chat.username ? `@${chat.username}` : String(chat.id)))
    });
  }
  return [...chats.values()];
}

async function callTelegram<T>(botToken: string, method: string, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(
    fetch,
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/${method}`,
    { method: "GET" },
    timeoutMs,
    `Telegram ${method}`
  );
  const reply = (await response.json().catch(() => ({ ok: false }))) as TelegramApiReply<T>;
  if (!response.ok || !reply.ok || reply.result === undefined) {
    throw new Error(reply.description ?? `Telegram ${method} failed with HTTP ${response.status}`);
  }
  return reply.result;
}

/**
 * In GitHub Actions, also put the digest on the run's summary page, so the Actions tab doubles as
 * a place to read results (and a way to check a run without Telegram).
 */
function writeGithubJobSummary(message: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, `${toMarkdownDigest(message)}\n`, "utf8");
  } catch (error) {
    logger.warn("could not write the GitHub job summary", { error: error instanceof Error ? error.message : String(error) });
  }
}
