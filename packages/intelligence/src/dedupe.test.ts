import assert from "node:assert/strict";
import test from "node:test";
import { buildEventDedupeKey, dedupeEvents } from "./dedupe.js";
import type { ExtractedEvent } from "./schemas.js";

test("dedupeEvents merges same-title same-day same-city events", () => {
  const base = eventFixture("left", "https://example.com/a");
  const duplicate = {
    ...eventFixture("right", "https://lu.ma/a"),
    title: "AI Builders Dinner San Francisco",
    hosts: ["Host B"],
    confidence: 0.95
  };

  const groups = dedupeEvents([base, duplicate]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.mergedIds, ["left", "right"]);
  assert.equal(groups[0]?.event.canonicalUrl, "https://lu.ma/a");
  assert.deepEqual(groups[0]?.event.hosts, ["Host A", "Host B"]);
  assert.equal(groups[0]?.event.confidence, 0.95);
});

test("buildEventDedupeKey includes date and city", () => {
  assert.equal(
    buildEventDedupeKey({
      title: "AI Builders Dinner SF",
      startAt: "2026-08-25T02:00:00.000Z",
      city: "San Francisco"
    }),
    "ai builders dinner|2026-08-25|san francisco"
  );
});

test("dedupeEvents merges same local event when extracted start times differ slightly", () => {
  const sevenPm = {
    ...eventFixture("startup-grind-7", "https://example.com/startup-grind-august"),
    title: "Startup Grind San Francisco August Edition",
    startAt: "2026-08-28T02:00:00.000Z",
    hosts: ["Startup Grind San Francisco"],
    organizers: ["Startup Grind San Francisco"],
    eventType: "other" as const
  };
  const eightPm = {
    ...eventFixture("startup-grind-8", "https://lu.ma/startup-grind-august"),
    title: "Startup Grind SF - August Edition",
    startAt: "2026-08-28T03:00:00.000Z",
    hosts: ["Startup Grind SF"],
    organizers: ["Startup Grind SF"],
    eventType: "other" as const
  };

  const groups = dedupeEvents([sevenPm, eightPm]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.mergedIds, ["startup-grind-7", "startup-grind-8"]);
  assert.equal(groups[0]?.event.canonicalUrl, "https://lu.ma/startup-grind-august");
});

test("buildEventDedupeKey uses timezone when provided", () => {
  assert.equal(
    buildEventDedupeKey({
      title: "AI Builders Dinner SF",
      startAt: "2026-08-25T02:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco"
    }),
    "ai builders dinner|2026-08-24|san francisco"
  );
});

function eventFixture(id: string, canonicalUrl: string): ExtractedEvent {
  return {
    id,
    canonicalUrl,
    sourceUrls: [canonicalUrl],
    title: "AI Builders Dinner SF",
    description: "Small dinner for AI builders.",
    startAt: "2026-08-25T02:00:00.000Z",
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    locationPrecision: "city_only",
    hosts: ["Host A"],
    organizers: ["Host A"],
    platforms: ["luma"],
    visibilityFlags: ["approval_required"],
    registrationStatus: "approval_required",
    eventType: "dinner",
    confidence: 0.8
  };
}
