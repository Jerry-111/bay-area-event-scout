import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate } from "@event-scout/shared";
import { buildFeedbackUrl, parseFeedbackPayload, renderTelegramDigest, toMarkdownDigest, toPlainTextDigest } from "./index.js";

test("renderTelegramDigest includes ranking, score, event link, summary, and admin link", () => {
  const digest = renderTelegramDigest([eventFixture()], {
    appBaseUrl: "https://admin.example.com/?token=secret",
    now: new Date("2026-08-22T12:00:00.000Z")
  });

  assert.match(digest, /1\. AI Builders Dinner/);
  assert.match(digest, /\(88\)/);
  assert.match(digest, /https:\/\/lu.ma\/event-1/);
  assert.match(digest, /Why: Strong AI\/founder fit/);
  assert.match(digest, /admin dashboard/);
  assert.doesNotMatch(digest, /secret/);
});

test("renderTelegramDigest header uses singular \"event\" for exactly one event, plural otherwise", () => {
  const one = renderTelegramDigest([eventFixture()], { now: new Date("2026-08-22T12:00:00.000Z") });
  assert.match(one, /^Bay Event Scout: 1 event\n/);

  const two = renderTelegramDigest(
    [eventFixture({ id: "a" }), eventFixture({ id: "b", title: "Second Dinner" })],
    { now: new Date("2026-08-22T12:00:00.000Z") }
  );
  assert.match(two, /^Bay Event Scout: 2 events\n/);
});

test("renderTelegramDigest only includes events in the next month", () => {
  const digest = renderTelegramDigest(
    [
      eventFixture({ id: "past", title: "Past Dinner", startAt: "2026-08-20T02:00:00.000Z" }),
      eventFixture({ id: "missing", title: "Date TBD", startAt: undefined }),
      eventFixture({ id: "too-far", title: "October Dinner", startAt: "2026-10-01T02:00:00.000Z" }),
      eventFixture({ id: "future", title: "Future Dinner", startAt: "2026-09-10T02:00:00.000Z" })
    ],
    { now: new Date("2026-08-22T12:00:00.000Z") }
  );

  assert.match(digest, /Future Dinner/);
  assert.doesNotMatch(digest, /Past Dinner/);
  assert.doesNotMatch(digest, /Date TBD/);
  assert.doesNotMatch(digest, /October Dinner/);
});

test("renderTelegramDigest always includes 80+ recommendations and shows 65-79 alternatives", () => {
  const digest = renderTelegramDigest(
    [
      eventFixture({ id: "top", title: "Top Dinner", score: 92 }),
      eventFixture({ id: "strong", title: "Strong Salon", score: 84 }),
      eventFixture({ id: "alternative", title: "Maybe Worth It", score: 72 }),
      eventFixture({ id: "weak", title: "Weak Meetup", score: 59 })
    ],
    {
      maxAlternatives: 1,
      now: new Date("2026-08-22T12:00:00.000Z")
    }
  );

  assert.match(digest, /Top Dinner/);
  assert.match(digest, /Strong Salon/);
  assert.match(digest, /Possible \(65-79\)/);
  assert.match(digest, /Maybe Worth It/);
  assert.doesNotMatch(digest, /Weak Meetup/);
});

test("renderTelegramDigest includes all 65-79 possible events by default", () => {
  const digest = renderTelegramDigest(
    [
      eventFixture({ id: "alternative-1", title: "Maybe Worth It 1", score: 79 }),
      eventFixture({ id: "alternative-2", title: "Maybe Worth It 2", score: 72 }),
      eventFixture({ id: "alternative-3", title: "Maybe Worth It 3", score: 66 })
    ],
    { now: new Date("2026-08-22T12:00:00.000Z") }
  );

  assert.match(digest, /Maybe Worth It 1/);
  assert.match(digest, /Maybe Worth It 2/);
  assert.match(digest, /Maybe Worth It 3/);
});

test("renderTelegramDigest uses the profile's score bands", () => {
  const digest = renderTelegramDigest(
    [
      eventFixture({ id: "top", title: "Top Dinner", score: 90 }),
      eventFixture({ id: "near", title: "Near Miss", score: 72 }),
      eventFixture({ id: "low", title: "Low Salon", score: 60 })
    ],
    { thresholds: { recommend: 90, review: 70 }, now: new Date("2026-08-22T12:00:00.000Z") }
  );

  assert.match(digest, /Recommended \(90\+\)/);
  assert.match(digest, /Possible \(70-89\)/);
  assert.match(digest, /Near Miss/);
  assert.doesNotMatch(digest, /Low Salon/);
});

test("renderTelegramDigest truncates long digests to fit Telegram", () => {
  const digest = renderTelegramDigest(
    Array.from({ length: 8 }, (_, index) =>
      eventFixture({
        id: `event-${index}`,
        title: `Very Long AI Founder Dinner ${index}`,
        score: 90 - index,
        hosts: [`Host ${index}`, "A very long organizer name that should be shortened in the Telegram digest"],
        reasons: [
          "This is a long rationale with lots of detail about room quality, founder density, investor attendance, timing, venue quality, format, and why it matches the scout rubric.".repeat(4)
        ],
        risks: [
          "This is a long risk note about unclear registration, uncertain room composition, and possible fit concerns.".repeat(3)
        ]
      })
    ),
    {
      appBaseUrl: "https://admin.example.com",
      maxLength: 1200,
      now: new Date("2026-08-22T12:00:00.000Z")
    }
  );

  assert.ok(digest.length <= 1200);
  assert.match(digest, /Digest truncated to fit Telegram message limits/);
});

test("feedback payloads validate allowed feedback types", () => {
  const url = buildFeedbackUrl({
    appBaseUrl: "https://admin.example.com",
    eventId: "event-1",
    type: "good"
  });
  const parsed = parseFeedbackPayload(new URL(url).searchParams);

  assert.equal(parsed.eventId, "event-1");
  assert.equal(parsed.type, "good");
  assert.ok(parsed.createdAt);
});

test("toPlainTextDigest strips HTML tags and unescapes entities while keeping the content readable", () => {
  const digest = renderTelegramDigest(
    [eventFixture({ title: "R&D Founders Night", reasons: ['Great for "builders" & founders'] })],
    { appBaseUrl: "https://admin.example.com", now: new Date("2026-08-22T12:00:00.000Z") }
  );

  // Sanity check: the HTML digest really does contain escaped entities and an anchor tag,
  // otherwise this test would pass trivially.
  assert.match(digest, /&amp;/);
  assert.match(digest, /<a href=/);

  const plainText = toPlainTextDigest(digest);

  assert.doesNotMatch(plainText, /&amp;|&lt;|&gt;|&quot;/, "no HTML entities should remain");
  assert.doesNotMatch(plainText, /<a[\s>]|<\/a>/i, "no anchor tags should remain");
  assert.match(plainText, /R&D Founders Night/, "escaped characters should be restored to plain text");
  assert.match(plainText, /Great for "builders" & founders/, "escaped quotes and ampersands should be restored");
  assert.match(plainText, /admin dashboard \(https:\/\/admin\.example\.com\/?\)/, "the admin link should render as label plus URL");
});

test("toPlainTextDigest leaves plain digests (no links) unchanged apart from entity unescaping", () => {
  const digest = renderTelegramDigest([eventFixture()], { now: new Date("2026-08-22T12:00:00.000Z") });
  const plainText = toPlainTextDigest(digest);
  assert.match(plainText, /1\. AI Builders Dinner/);
  assert.match(plainText, /Link: https:\/\/lu\.ma\/event-1/);
});

test("toMarkdownDigest turns the digest into headings and hard-broken lines for a GitHub job summary", () => {
  const digest = renderTelegramDigest(
    [eventFixture({ title: "Founders <3 *AI* Dinner_SF", canonicalUrl: "https://lu.ma/founders_dinner" })],
    { now: new Date("2026-08-22T12:00:00.000Z") }
  );
  const markdown = toMarkdownDigest(digest).split("\n");
  assert.equal(markdown[0], "### Bay Event Scout: 1 event");
  assert.ok(markdown.includes("#### Recommended (80+)"));
  assert.ok(
    markdown.some((line) => line.startsWith("1. Founders \\<3 \\*AI\\* Dinner\\_SF") && line.endsWith("  ")),
    "title characters that mean something in Markdown are escaped"
  );
  assert.ok(markdown.includes("Link: https://lu.ma/founders_dinner  "), "URLs are left alone so they still link");
});

function eventFixture(overrides: Partial<EventCandidate> = {}): EventCandidate {
  return {
    id: "event-1",
    canonicalUrl: "https://lu.ma/event-1",
    sourceUrls: ["https://lu.ma/event-1"],
    sourcePlatforms: ["mock"],
    title: "AI Builders Dinner",
    startAt: "2026-08-25T02:00:00.000Z",
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    venueText: "TBD",
    locationPrecision: "city_only",
    hosts: ["Host A"],
    description: "Small approval-required dinner for AI builders.",
    status: "approval_required",
    visibilityFlags: ["approval_required"],
    score: 88,
    reasons: ["Strong AI/founder fit"],
    risks: [],
    ...overrides
  };
}
