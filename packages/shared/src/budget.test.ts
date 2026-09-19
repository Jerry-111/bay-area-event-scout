import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv, resolveScoutBudget, SCOUT_BUDGETS } from "./index.js";

test("SCOUT_BUDGET unset keeps the long-standing large limits", () => {
  const { budgets } = loadEnv({});
  assert.equal(budgets.preset, "large");
  assert.equal(budgets.maxExaSearchesPerRun, 40);
  assert.equal(budgets.maxXPostsPerDay, 150);
  assert.equal(budgets.maxXPostsPerRun, 150);
  assert.equal(budgets.maxFirecrawlPagesPerRun, 60);
  assert.equal(budgets.maxLlmExtractCandidatesPerRun, 40);
  assert.equal(budgets.maxLlmScoreEventsPerRun, 25);
});

test("SCOUT_BUDGET sets every cap, and an explicit MAX_* value still wins", () => {
  const small = loadEnv({ SCOUT_BUDGET: "Small" }).budgets;
  assert.equal(small.preset, "small");
  assert.equal(small.maxExaSearchesPerRun, SCOUT_BUDGETS.small.exaSearches);
  assert.equal(small.maxAgentGeneratedExaQueries, Math.floor(SCOUT_BUDGETS.small.exaSearches / 2));
  assert.equal(small.maxXPostsPerRun, SCOUT_BUDGETS.small.xPostsPerDay);
  assert.equal(small.maxLlmScoreEventsPerRun, SCOUT_BUDGETS.small.llmScores);

  const tuned = loadEnv({ SCOUT_BUDGET: "medium", MAX_EXA_SEARCHES_PER_RUN: "5", MAX_FIRECRAWL_PAGES_PER_RUN: "" }).budgets;
  assert.equal(tuned.maxExaSearchesPerRun, 5);
  assert.equal(tuned.maxFirecrawlPagesPerRun, SCOUT_BUDGETS.medium.firecrawlPages, "an empty MAX_* falls back to the budget");
});

test("an unknown SCOUT_BUDGET fails loudly with the valid names", () => {
  assert.throws(() => resolveScoutBudget("cheap"), /small, medium, large/);
  assert.equal(resolveScoutBudget(" "), "large");
});

test("the budgets only ever get bigger from small to large", () => {
  const keys = Object.keys(SCOUT_BUDGETS.small) as Array<keyof typeof SCOUT_BUDGETS.small>;
  for (const key of keys) {
    assert.ok(SCOUT_BUDGETS.small[key] <= SCOUT_BUDGETS.medium[key], key);
    assert.ok(SCOUT_BUDGETS.medium[key] <= SCOUT_BUDGETS.large[key], key);
  }
});
