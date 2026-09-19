import assert from "node:assert/strict";
import test from "node:test";
import type { AppEnv, EventCandidate } from "@event-scout/shared";
import { loadEnv } from "@event-scout/shared";
import { findTelegramChats, getTelegramBotUsername, sendDigest } from "./telegram.js";

function envFixture(overrides: Partial<AppEnv> = {}): AppEnv {
  return { ...loadEnv({ MOCK_MODE: "true" }), ...overrides };
}

function eventFixture(overrides: Partial<EventCandidate> = {}): EventCandidate {
  return {
    id: "event-1",
    canonicalUrl: "https://lu.ma/event-1",
    sourceUrls: ["https://lu.ma/event-1"],
    sourcePlatforms: ["mock"],
    title: "AI Builders Dinner",
    // renderTelegramDigest filters by the real wall-clock "now" (sendDigest
    // does not take a `now` override), so this must stay in the future.
    startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    venueText: "TBD",
    hosts: ["Host A"],
    description: "Small approval-required dinner for AI builders.",
    visibilityFlags: [],
    locationPrecision: "city_only",
    score: 88,
    reasons: ["Strong AI/founder fit"],
    risks: [],
    ...overrides
  };
}

async function captureConsoleLog(run: () => Promise<void>, logFormat: "pretty" | "json" = "pretty"): Promise<string[]> {
  const originalLog = console.log;
  const originalFormat = process.env.LOG_FORMAT;
  process.env.LOG_FORMAT = logFormat;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await run();
  } finally {
    console.log = originalLog;
    if (originalFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalFormat;
  }
  return lines;
}

test("sendDigest keeps JSON logs one object per line when Telegram is not configured", async () => {
  const lines = await captureConsoleLog(async () => {
    await sendDigest([eventFixture()], envFixture({ mockMode: true }));
  }, "json");

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!) as { message: string; digest: string; reason: string };
  assert.equal(entry.reason, "mock mode");
  assert.match(entry.digest, /AI Builders Dinner/);
  assert.doesNotMatch(entry.digest, /<[a-z][^>]*>/i);
});

test("sendDigest prints a readable plain-text digest (no HTML tags or entities) when Telegram is not configured", async () => {
  const lines = await captureConsoleLog(async () => {
    const result = await sendDigest([eventFixture()], envFixture({ mockMode: true }));
    assert.equal(result.delivered, false);
    assert.equal(result.mock, true);
  });

  const printed = lines.join("\n");
  assert.doesNotMatch(printed, /<[a-z][^>]*>/i, "no HTML tags should be printed to the console");
  assert.doesNotMatch(printed, /&(amp|lt|gt|quot);/, "no HTML entities should be printed to the console");
  assert.match(printed, /AI Builders Dinner/);
});

test("sendDigest also prints plain text in real mode when no Telegram credentials are configured", async () => {
  const lines = await captureConsoleLog(async () => {
    await sendDigest([eventFixture()], envFixture({ mockMode: false, telegramBotToken: undefined, telegramChatId: undefined }));
  });

  const printed = lines.join("\n");
  assert.doesNotMatch(printed, /<[a-z][^>]*>/i);
  assert.match(printed, /no Telegram bot configured/);
});

test("findTelegramChats lists each chat that messaged the bot once, newest first, with a readable name", async () => {
  const updates = [
    { update_id: 1, message: { chat: { id: 111, type: "private", first_name: "Maya", last_name: "Lee" } } },
    { update_id: 2, my_chat_member: { chat: { id: -1002, type: "supergroup", title: "Founder dinners" } } },
    { update_id: 3, message: { chat: { id: 111, type: "private", first_name: "Maya", last_name: "Lee" } } },
    { update_id: 4, message: { chat: { id: 333, type: "private", username: "someone" } } }
  ];
  await withTelegramFetch({ ok: true, result: updates }, async (requested) => {
    const chats = await findTelegramChats("123:abc");
    assert.deepEqual(chats, [
      { id: "333", type: "private", name: "@someone" },
      { id: "111", type: "private", name: "Maya Lee" },
      { id: "-1002", type: "supergroup", name: "Founder dinners" }
    ]);
    assert.equal(requested[0], "https://api.telegram.org/bot123%3Aabc/getUpdates");
  });
});

test("getTelegramBotUsername surfaces Telegram's reason for a bad token", async () => {
  await withTelegramFetch({ ok: false, description: "Unauthorized" }, async () => {
    await assert.rejects(getTelegramBotUsername("wrong"), /Unauthorized/);
  }, 401);
  await withTelegramFetch({ ok: true, result: { username: "maya_scout_bot" } }, async () => {
    assert.equal(await getTelegramBotUsername("123:abc"), "maya_scout_bot");
  });
});

async function withTelegramFetch(reply: unknown, run: (requested: string[]) => Promise<void>, status = 200): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await run(requested);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
