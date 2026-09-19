import assert from "node:assert/strict";
import test from "node:test";
import { createRunStats, type ScoutRun } from "@event-scout/shared";
import { dashboardDisplayRun } from "./dashboard-builders.js";

function run(id: string, status: ScoutRun["status"]): ScoutRun {
  return { id, runType: "daily", startedAt: "2026-09-18T16:00:00.000Z", status, stats: createRunStats({ mockMode: false }) };
}

test("the dashboard keeps showing the last finished scan while a new one runs", () => {
  assert.equal(dashboardDisplayRun([run("new", "running"), run("done", "succeeded")])?.id, "done");
  assert.equal(dashboardDisplayRun([run("new", "running"), run("broken", "failed")])?.id, "broken");
  assert.equal(dashboardDisplayRun([run("only", "running")])?.id, "only");
  assert.equal(dashboardDisplayRun([run("done", "succeeded"), run("older", "succeeded")])?.id, "done");
  assert.equal(dashboardDisplayRun([]), undefined);
});
