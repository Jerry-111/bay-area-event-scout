import assert from "node:assert/strict";
import test from "node:test";
import { classifyEventWindowRejection } from "@event-scout/shared";
import { toSharedEventCandidate } from "./index.js";
import type { ExtractedEvent, StructuredEventScore } from "./schemas.js";

test("toSharedEventCandidate preserves missing startAt", () => {
  const event = eventFixture();
  const shared = toSharedEventCandidate({ ...event, startAt: undefined }, scoreFixture(event.id));

  assert.equal(shared.startAt, undefined);
});

test("classifyEventWindowRejection explains page-level date gate decisions", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");

  assert.equal(classifyEventWindowRejection({}, { now }), "missing_date");
  assert.equal(classifyEventWindowRejection({ startAt: "not-a-date" }, { now }), "invalid_date");
  assert.equal(classifyEventWindowRejection({ startAt: "2026-08-22T19:00:00.000Z" }, { now }), "past_event");
  assert.equal(classifyEventWindowRejection({ startAt: "2026-10-01T19:00:00.000Z" }, { now }), "too_far_future");
  assert.equal(classifyEventWindowRejection({ startAt: "2026-09-01T19:00:00.000Z" }, { now }), undefined);
});

function eventFixture(): ExtractedEvent {
  return {
    id: "event-1",
    canonicalUrl: "https://lu.ma/event-1",
    sourceUrls: ["https://lu.ma/event-1"],
    title: "AI Builders Dinner",
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

function scoreFixture(eventId: string): StructuredEventScore {
  return {
    eventId,
    totalScore: 88,
    userFit: 23,
    roomQuality: 18,
    networkingValue: 14,
    timeliness: 8,
    locationActionability: 9,
    novelty: 8,
    evidenceConfidence: 8,
    penalties: [],
    shouldRecommend: true,
    rationale: "Strong AI/founder fit",
    nextAction: "apply"
  };
}
