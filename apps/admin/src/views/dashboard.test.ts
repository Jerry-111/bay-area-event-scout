import assert from "node:assert/strict";
import test from "node:test";
import type { AdminDashboard } from "@event-scout/db";
import { renderDashboard, type DashboardDataSource } from "./dashboard.js";

test("renderDashboard shows a plain-English getting-started empty state on Today when there are no runs yet", () => {
  const html = renderDashboard(dashboardFixture({ runs: [] }), { dataSource: "file", canSignOut: false });

  assert.match(html, /No scans yet/);
  assert.match(html, /pnpm scout:mock/);
  assert.match(html, /pnpm scout:real/);
  // The getting-started state replaces the normal Today body, not just adds to it.
  assert.doesNotMatch(html, /Nothing cleared the bar in the latest scan/);
});

test("renderDashboard renders the normal Today tab once at least one run exists", () => {
  const html = renderDashboard(dashboardFixture(), { dataSource: "file", canSignOut: false });
  assert.doesNotMatch(html, /No scans yet/);
  assert.match(html, /Act now/);
  assert.match(html, /Worth a look/);
  assert.match(html, /Hidden/);
});

test("renderDashboard states the data source in the header for mock, file, and Postgres", () => {
  const cases: Array<[DashboardDataSource, RegExp]> = [
    ["mock", /mock data/],
    ["file", /local file data/],
    ["postgres", /Postgres/]
  ];

  for (const [dataSource, expected] of cases) {
    const html = renderDashboard(dashboardFixture(), { dataSource, canSignOut: false });
    assert.match(html, expected, `expected the header to mention "${dataSource}" data`);
  }
});

test("renderDashboard keeps the four deep-linkable tabs and reuses the single event card everywhere", () => {
  const html = renderDashboard(
    dashboardFixture({
      recommendedEvents: [{
        recommendation: { id: "rec-1", runId: "run-1", eventId: "event-1", score: 88, reason: "Great fit", createdAt: new Date().toISOString() },
        event: eventFixture(),
        score: { eventId: "event-1", totalScore: 88, score: 88 }
      }]
    }),
    { dataSource: "file", canSignOut: false }
  );

  for (const tabId of ["today", "history", "health", "tuning"]) {
    assert.match(html, new RegExp(`id="tab-${tabId}"`));
    assert.match(html, new RegExp(`id="panel-${tabId}"`));
  }
  // eventCard's own "Score breakdown and event details" summary marks every card; it should show
  // for the one recommended event and nowhere be duplicated by a second, different card renderer.
  const cardMatches = html.match(/Score breakdown and event details/g) ?? [];
  assert.equal(cardMatches.length, 1);
});

function dashboardFixture(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    runs: [{
      id: "run-1",
      runType: "manual",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "succeeded",
      stats: {
        candidatesFound: 3,
        pagesInspected: 2,
        eventsExtracted: 2,
        scoresCreated: 2,
        recommendationsCreated: 1,
        rejectedCandidates: 1,
        mockMode: false,
        scanMode: "light",
        xEnabled: false,
        xPostsRead: 0,
        xBudgetRemaining: 0
      }
    }],
    candidateCounts: {},
    topRecommendations: [],
    rejectedCandidates: [],
    events: [],
    scores: [],
    today: {
      scanMode: "light",
      xPostsUsedToday: 0,
      xDailyBudget: 150,
      candidateCount: 3,
      eventCount: 2,
      recommendationCount: 1
    },
    health: { status: "healthy", message: "Latest successful run is recent." },
    recommendedEvents: [],
    recommendationHistory: [],
    suppressedEvents: [],
    reviewCandidates: [],
    rejectionSummary: [],
    sourcePerformance: [],
    organizerPerformance: [],
    feedbackSummary: [],
    tasteSignals: [],
    missedEvents: [],
    dataGaps: [],
    thresholds: { recommend: 80, review: 65 },
    profile: { name: "consumer-ai-founder", source: "built-in default", persona: "an early-stage consumer AI founder" },
    ...overrides
  };
}

function eventFixture(): AdminDashboard["events"][number] {
  return {
    id: "event-1",
    canonicalUrl: "https://lu.ma/event-1",
    sourceUrls: ["https://lu.ma/event-1"],
    title: "AI Founders Dinner",
    startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    venueText: "TBD",
    locationPrecision: "city_only",
    hosts: ["Some Host"],
    visibilityFlags: [],
    score: 88
  };
}
