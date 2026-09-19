import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyQueryPack } from "@event-scout/discovery";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProfile, type AppEnv } from "@event-scout/shared";
import { buildAgenticSearchPlan, mergeAgenticSearchPlan, summarizeQueryMix } from "./search-planner.js";

const baseEnv: AppEnv = {
  ...loadEnv({ MOCK_MODE: "true" }),
  adminPort: 8787,
  budgets: {
    maxExaSearchesPerRun: 40,
    maxAgentGeneratedExaQueries: 20,
    maxAgentGeneratedXQueries: 0,
    maxExplorationBudgetPercent: 50,
    maxXPostsPerRun: 10,
    maxXPostsPerDay: 10,
    maxFirecrawlPagesPerRun: 0,
    maxLlmExtractCandidatesPerRun: 0,
    maxLlmScoreEventsPerRun: 0,
    maxRecommendationsPerRun: 0
  }
};
const profile = baseEnv.profile;

test("buildAgenticSearchPlan creates mock exploration queries for variety", async () => {
  const now = new Date("2026-08-23T12:00:00-07:00");
  const staticQueryPack = buildDailyQueryPack(now, { scanTime: "14:00", profile });
  const plan = await buildAgenticSearchPlan({
    env: baseEnv,
    now,
    scanTime: "14:00",
    runContext: {
      scanMode: "light",
      xEnabled: false,
      xBudgetRemaining: 10
    },
    staticQueryPack,
    history: {
      recentCandidates: [],
      recentEvents: [],
      recentRecommendations: []
    }
  });

  assert.equal(plan.planner, "mock");
  assert.equal(plan.targetExaQueries, 20);
  assert.equal(plan.items.length, 20);
  assert.ok(plan.items.every((item) => item.connector === "exa"));
  assert.ok(plan.items.every((item) => item.query.includes("-hackathon")));
});

test("mergeAgenticSearchPlan gives agent exploration half of Exa query budget", async () => {
  const now = new Date("2026-08-23T12:00:00-07:00");
  const staticQueryPack = buildDailyQueryPack(now, { scanTime: "18:00", profile });
  const plan = await buildAgenticSearchPlan({
    env: baseEnv,
    now,
    scanTime: "18:00",
    runContext: {
      scanMode: "light",
      xEnabled: false,
      xBudgetRemaining: 10
    },
    staticQueryPack,
    history: {
      recentCandidates: [],
      recentEvents: [],
      recentRecommendations: []
    }
  });
  const plannedPack = mergeAgenticSearchPlan(staticQueryPack, plan, baseEnv);
  const mix = summarizeQueryMix(plannedPack);

  assert.equal(mix.exaQueries, 40);
  assert.equal(mix.agentExaQueries, 20);
  assert.equal(mix.agentExaPercent, 50);
  assert.equal(plannedPack.some((query) => query.connector === "x"), false);
  assert.ok(plannedPack.some((query) => query.connector === "public_source"));
});

test("buildAgenticSearchPlan follows up on high-value recommended organizers", async () => {
  const now = new Date("2026-08-23T12:00:00-07:00");
  const staticQueryPack = buildDailyQueryPack(now, { scanTime: "14:00", profile });
  const plan = await buildAgenticSearchPlan({
    env: baseEnv,
    now,
    scanTime: "14:00",
    runContext: {
      scanMode: "light",
      xEnabled: false,
      xBudgetRemaining: 10
    },
    staticQueryPack,
    history: {
      recentCandidates: [],
      recentEvents: [
        {
          id: "event-homebrew",
          canonicalUrl: "https://luma.com/homebrew",
          sourceUrls: ["https://luma.com/homebrew"],
          title: "Founder AI Dinner",
          city: "San Francisco",
          locationPrecision: "exact",
          hosts: ["Homebrew Club", "Umar"],
          organizers: ["Change Mechanics"],
          visibilityFlags: [],
          score: 92
        }
      ],
      recentRecommendations: [
        {
          id: "rec-homebrew",
          runId: "run-1",
          eventId: "event-homebrew",
          score: 92,
          reason: "High-signal founder room.",
          createdAt: now.toISOString()
        }
      ]
    }
  });

  assert.ok(plan.items.some((item) => item.noveltyAxis === "organizer_follow_up" && item.query.includes("\"Homebrew Club\"")));
  assert.ok(plan.items.some((item) => item.query.includes("\"Change Mechanics\"")));
  assert.equal(plan.items.some((item) => item.query.includes("\"Umar\"")), false);
});

test("buildAgenticSearchPlan explores the active profile's topics", async () => {
  const now = new Date("2026-08-23T12:00:00-07:00");
  const fintech = loadProfile({ cwd: dirname(fileURLToPath(import.meta.url)), env: { SCOUT_PROFILE: "fintech" } }).profile;
  const env: AppEnv = { ...baseEnv, profile: fintech };
  const plan = await buildAgenticSearchPlan({
    env,
    now,
    scanTime: "09:00",
    runContext: {
      scanMode: "full",
      xEnabled: true,
      xBudgetRemaining: 10
    },
    staticQueryPack: buildDailyQueryPack(now, { scanTime: "09:00", profile: fintech }),
    history: {
      recentCandidates: [],
      recentEvents: [],
      recentRecommendations: []
    }
  });
  const text = plan.items.map((item) => item.query).join("\n");

  assert.equal(plan.items.length, 20);
  assert.ok(text.includes("fintech founders") || text.includes("payments founders"));
  assert.equal(text.includes("consumer AI"), false);
  assert.ok(plan.items.every((item) => item.query.includes("-hackathon")));
});
