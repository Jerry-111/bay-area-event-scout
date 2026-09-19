import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROFILE, type EventCandidate, type RawCandidate, type Recommendation } from "@event-scout/shared";
import { buildScores, eventsForDigest, filterPreviouslyRecommendedEvents, rankCandidatesForExtraction } from "./run-scout.js";
import { loadEnv } from "@event-scout/shared";

test("filterPreviouslyRecommendedEvents suppresses events already recommended by URL", () => {
  const current = eventFixture({
    id: "event-new-id",
    canonicalUrl: "https://lu.ma/startup-grind-august?utm_source=exa",
    sourceUrls: ["https://lu.ma/startup-grind-august?utm_source=exa"]
  });
  const historical = eventFixture({
    id: "event-old-id",
    canonicalUrl: "https://lu.ma/startup-grind-august",
    sourceUrls: ["https://lu.ma/startup-grind-august"]
  });

  const result = filterPreviouslyRecommendedEvents([current], {
    events: [historical],
    recommendations: [recommendationFixture({ eventId: historical.id })]
  });

  assert.deepEqual(result.eligible, []);
  assert.deepEqual(result.skipped.map((event) => event.id), ["event-new-id"]);
});

test("filterPreviouslyRecommendedEvents suppresses fuzzy duplicate recommendations", () => {
  const current = eventFixture({
    id: "startup-grind-8",
    canonicalUrl: "https://example.com/startup-grind-august-8",
    sourceUrls: ["https://example.com/startup-grind-august-8"],
    title: "Startup Grind SF - August Edition",
    startAt: "2026-08-28T03:00:00.000Z"
  });
  const historical = eventFixture({
    id: "startup-grind-7",
    canonicalUrl: "https://example.com/startup-grind-august-7",
    sourceUrls: ["https://example.com/startup-grind-august-7"],
    title: "Startup Grind San Francisco August Edition",
    startAt: "2026-08-28T02:00:00.000Z"
  });
  const newEvent = eventFixture({
    id: "new-dinner",
    canonicalUrl: "https://lu.ma/new-dinner",
    sourceUrls: ["https://lu.ma/new-dinner"],
    title: "AI Founder Dinner",
    hosts: ["Different Host"],
    organizers: ["Different Host"]
  });

  const result = filterPreviouslyRecommendedEvents([current, newEvent], {
    events: [historical],
    recommendations: [recommendationFixture({ eventId: historical.id })]
  });

  assert.deepEqual(result.eligible.map((event) => event.id), ["new-dinner"]);
  assert.deepEqual(result.skipped.map((event) => event.id), ["startup-grind-8"]);
});

test("rankCandidatesForExtraction prioritizes concrete event pages over source/listing pages", () => {
  const ranked = rankCandidatesForExtraction([
    rawCandidateFixture({
      id: "source",
      sourceUrl: "https://homebrewclub.berrry.app/",
      url: "https://homebrewclub.berrry.app/",
      canonicalUrl: "https://homebrewclub.berrry.app/",
      title: "Homebrew Club — Community Coworking Space",
      snippet: "AI founder community event space in San Francisco with demo nights and gatherings.",
      sourceScore: 100
    }),
    rawCandidateFixture({
      id: "event",
      sourceUrl: "https://lu.ma/agent-demo-night",
      url: "https://lu.ma/agent-demo-night",
      canonicalUrl: "https://lu.ma/agent-demo-night",
      title: "Agent Demo Night",
      snippet: "Apply to attend this San Francisco builder demo night on September 12, 2026.",
      sourceScore: 82
    })
  ], DEFAULT_PROFILE);

  assert.equal(ranked[0]?.id, "event");
});

test("buildScores keeps the scorer's component breakdown and applies the profile threshold", () => {
  const [scored, legacy] = buildScores(
    [
      eventFixture({
        id: "scored",
        score: 82,
        scoreBreakdown: {
          userFit: 24,
          roomQuality: 17,
          networkingValue: 12,
          timeliness: 9,
          locationActionability: 9,
          novelty: 5,
          evidenceConfidence: 6,
          nextAction: "rsvp"
        }
      }),
      eventFixture({ id: "legacy", score: 82 })
    ],
    { ...DEFAULT_PROFILE, thresholds: { recommend: 85, review: 70 } }
  );

  assert.equal(scored?.userFit, 24);
  assert.equal(scored?.novelty, 5);
  assert.equal(scored?.nextAction, "rsvp");
  assert.equal(scored?.shouldRecommend, false);
  assert.equal(legacy?.userFit, 21);
  assert.equal(legacy?.nextAction, "monitor");
});

test("rankCandidatesForExtraction moves candidates that were recommended before to the end", () => {
  const historical = eventFixture({
    id: "event-old-id",
    canonicalUrl: "https://lu.ma/already-recommended",
    sourceUrls: ["https://lu.ma/already-recommended"],
    title: "Already Recommended Founder Dinner"
  });
  const ranked = rankCandidatesForExtraction(
    [
      rawCandidateFixture({
        id: "old",
        sourceUrl: "https://lu.ma/already-recommended",
        url: "https://lu.ma/already-recommended",
        canonicalUrl: "https://lu.ma/already-recommended",
        title: "Already Recommended Founder Dinner",
        snippet: "San Francisco founder dinner on September 12, 2026.",
        sourceScore: 100
      }),
      rawCandidateFixture({
        id: "fresh",
        sourceUrl: "https://lu.ma/fresh-founder-dinner",
        url: "https://lu.ma/fresh-founder-dinner",
        canonicalUrl: "https://lu.ma/fresh-founder-dinner",
        title: "Fresh Founder Dinner",
        snippet: "San Francisco founder dinner on September 13, 2026.",
        sourceScore: 82
      })
    ],
    DEFAULT_PROFILE,
    { events: [historical], recommendations: [recommendationFixture({ eventId: historical.id })] }
  );

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["fresh", "old"]);
});

test("the digest gets the saved recommendations plus the review band, not unsaved high scores", () => {
  const env = loadEnv({ MOCK_MODE: "true" });
  const saved = eventFixture({ id: "saved", score: 92 });
  const overCap = eventFixture({ id: "over-cap", score: 85 });
  const possible = eventFixture({ id: "possible", score: 70 });
  const low = eventFixture({ id: "low", score: 40 });
  const digest = eventsForDigest([saved, overCap, possible, low], [recommendationFixture({ eventId: "saved" })], env);
  assert.deepEqual(digest.map((event) => event.id), ["saved", "possible"]);
});

function eventFixture(overrides: Partial<EventCandidate> = {}): EventCandidate {
  return {
    id: "event-1",
    canonicalUrl: "https://lu.ma/event-1",
    sourceUrls: ["https://lu.ma/event-1"],
    sourcePlatforms: ["mock"],
    title: "Startup Grind San Francisco August Edition",
    startAt: "2026-08-28T02:00:00.000Z",
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    venueText: "TBD",
    locationPrecision: "city_only",
    hosts: ["Startup Grind San Francisco"],
    organizers: ["Startup Grind San Francisco"],
    description: "Startup community event.",
    registrationStatus: "open",
    visibilityFlags: [],
    eventType: "other",
    score: 88,
    reasons: ["Strong founder fit"],
    risks: [],
    ...overrides
  };
}

function rawCandidateFixture(overrides: Partial<RawCandidate> & { sourceScore?: number } = {}): RawCandidate {
  return {
    id: "candidate-1",
    runId: "run-1",
    sourceUrl: "https://lu.ma/event-1",
    url: "https://lu.ma/event-1",
    canonicalUrl: "https://lu.ma/event-1",
    title: "AI Founder Dinner",
    snippet: "San Francisco event on September 12, 2026.",
    sourcePlatform: "exa",
    discoveredAt: "2026-08-23T12:00:00.000Z",
    status: "new",
    evidence: [],
    ...overrides
  } as RawCandidate;
}

function recommendationFixture(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    runId: "run-1",
    eventId: "event-1",
    score: 88,
    reason: "Recommended previously.",
    createdAt: "2026-08-23T12:00:00.000Z",
    ...overrides
  };
}
