import type { AppEnv, CandidateUrl, EventCandidate, EventScore, Recommendation, ScoutRun } from "@event-scout/shared";
import { createRunStats } from "@event-scout/shared";
import type { DashboardMissedEvent, EventSourceLink, FeedbackRow } from "./types.js";

/**
 * Everything a `MemoryEventStore` keeps in RAM. `MockEventStore` gives each
 * instance a fresh, disposable state; `FileEventStore` gives it a state that
 * gets reloaded from and persisted back to a JSON file, so the two backends
 * share every bit of read/write and dashboard-building logic.
 */
export interface MemoryState {
  runs: ScoutRun[];
  candidates: CandidateUrl[];
  events: EventCandidate[];
  eventSources: EventSourceLink[];
  scores: EventScore[];
  recommendations: Recommendation[];
  feedback: FeedbackRow[];
  missedEvents: DashboardMissedEvent[];
}

export function createMemoryState(): MemoryState {
  return {
    runs: [],
    candidates: [],
    events: [],
    eventSources: [],
    scores: [],
    recommendations: [],
    feedback: [],
    missedEvents: []
  };
}

export function findRun(state: MemoryState, runId: string): ScoutRun {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  return run;
}

export function eventRunId(state: MemoryState, eventId: string): string | undefined {
  return state.events.find((event) => event.id === eventId)?.runId;
}

export function upsertMany<T extends { id: string }>(rows: T[], incoming: T[]): void {
  for (const item of incoming) {
    const index = rows.findIndex((row) => row.id === item.id);
    if (index === -1) {
      rows.unshift(item);
    } else {
      rows[index] = item;
    }
  }
}

/**
 * Canned sample data so `pnpm scout:mock` + `pnpm admin` shows something
 * useful with zero API keys. Only ever called for mock mode — never for real
 * runs, even when they fall back to the local file store.
 */
export function seedMockData(state: MemoryState, env: AppEnv): void {
  const runId = "run_mock_seed";
  state.runs.push({
    id: runId,
    runType: "daily",
    startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    finishedAt: new Date(Date.now() - 58 * 60 * 1000).toISOString(),
    status: "succeeded",
    stats: createRunStats({
      candidatesFound: 3,
      eventsExtracted: 2,
      scoresCreated: 2,
      recommendationsCreated: 1,
      rejectedCandidates: 1,
      mockMode: env.mockMode
    })
  });
  state.candidates.push(
    {
      id: "candidate_mock_ai_builders_dinner",
      runId,
      url: "https://lu.ma/mock-ai-builders-dinner",
      canonicalUrl: "https://lu.ma/mock-ai-builders-dinner",
      sourcePlatform: "mock",
      sourceQuery: "mock daily query",
      title: "AI Builders Dinner SF",
      snippet: "Small approval-based dinner for AI agent and consumer AI founders.",
      discoveredAt: new Date(Date.now() - 59 * 60 * 1000).toISOString(),
      status: "extracted"
    },
    {
      id: "candidate_mock_founder_meetup",
      runId,
      url: "https://example.com/founder-meetup",
      canonicalUrl: "https://example.com/founder-meetup",
      sourcePlatform: "mock",
      sourceQuery: "mock daily query",
      title: "Founder Meetup in SoMa",
      snippet: "Useful but broader founder meetup with unclear attendee curation.",
      discoveredAt: new Date(Date.now() - 59 * 60 * 1000).toISOString(),
      status: "extracted"
    },
    {
      id: "candidate_mock_generic_webinar",
      runId,
      url: "https://example.com/generic-webinar",
      canonicalUrl: "https://example.com/generic-webinar",
      sourcePlatform: "mock",
      sourceQuery: "mock daily query",
      title: "Generic AI Webinar",
      snippet: "Online vendor webinar.",
      discoveredAt: new Date(Date.now() - 59 * 60 * 1000).toISOString(),
      status: "rejected",
      rejectionReason: "online-only/vendor webinar"
    }
  );
  state.events.push({
    id: "event_mock_ai_builders_dinner",
    runId,
    canonicalUrl: "https://lu.ma/mock-ai-builders-dinner",
    sourceUrls: ["https://lu.ma/mock-ai-builders-dinner"],
    sourcePlatforms: ["mock"],
    title: "AI Builders Dinner SF",
    description: "Mock event for admin and workflow verification.",
    startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    venueText: "TBD",
    locationPrecision: "city_only",
    hosts: ["Mock Organizer"],
    organizers: ["Mock Organizer"],
    platforms: ["mock"],
    visibilityFlags: ["approval_required"],
    registrationStatus: "approval_required",
    eventType: "dinner",
    confidence: 0.86,
    score: 86,
    reasons: ["Small curated AI builder room", "Strong profile fit"],
    risks: ["Mock data; run a real scan to replace it"]
  }, {
    id: "event_mock_founder_meetup",
    runId,
    canonicalUrl: "https://example.com/founder-meetup",
    sourceUrls: ["https://example.com/founder-meetup"],
    sourcePlatforms: ["mock"],
    title: "Founder Meetup in SoMa",
    description: "Mock near-miss event for dashboard review.",
    startAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    venueText: "SoMa",
    locationPrecision: "neighborhood",
    hosts: ["Mock Community"],
    organizers: ["Mock Community"],
    platforms: ["mock"],
    visibilityFlags: [],
    registrationStatus: "open",
    eventType: "happy_hour",
    confidence: 0.72,
    score: 72,
    reasons: ["Bay Area and founder-relevant"],
    risks: ["Broader audience and weaker curation"]
  });
  state.scores.push({
    eventId: "event_mock_ai_builders_dinner",
    totalScore: 86,
    score: 86,
    userFit: 24,
    roomQuality: 18,
    networkingValue: 14,
    timeliness: 8,
    locationActionability: 8,
    novelty: 7,
    evidenceConfidence: 7,
    penalties: [],
    shouldRecommend: true,
    rationale: "Mock score: curated AI builders dinner with approval required.",
    nextAction: "apply",
    reasons: ["Small curated AI builder room"],
    risks: []
  }, {
    eventId: "event_mock_founder_meetup",
    totalScore: 72,
    score: 72,
    userFit: 18,
    roomQuality: 13,
    networkingValue: 12,
    timeliness: 8,
    locationActionability: 8,
    novelty: 6,
    evidenceConfidence: 7,
    penalties: ["Broader audience"],
    shouldRecommend: false,
    rationale: "Likely useful if the week is light, but not distinctive enough for the top digest.",
    nextAction: "monitor",
    reasons: ["Founder-relevant", "In San Francisco"],
    risks: ["Too generic"]
  });
  state.recommendations.push({
    id: "rec_mock_ai_builders_dinner",
    runId,
    eventId: "event_mock_ai_builders_dinner",
    score: 86,
    reason: "Small curated AI builder room; approval required.",
    createdAt: new Date(Date.now() - 58 * 60 * 1000).toISOString()
  });
}
