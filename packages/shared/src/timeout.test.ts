import assert from "node:assert/strict";
import test from "node:test";
import { withTimeout } from "./timeout.js";

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

test("withTimeout resolves when the promise finishes first", async () => {
  assert.equal(await withTimeout(delay("done", 5), 200, "quick call"), "done");
});

test("withTimeout rejects with a labeled error when the promise is too slow", async () => {
  await assert.rejects(withTimeout(delay("late", 200), 10, "slow call"), /slow call timed out after 10ms/);
});

test("withTimeout propagates the original rejection when the promise fails first", async () => {
  const failing = Promise.reject(new Error("boom"));
  await assert.rejects(withTimeout(failing, 200, "failing call"), /boom/);
});

test("withTimeout skips the race entirely for a non-positive timeout", async () => {
  assert.equal(await withTimeout(delay("done", 5), 0, "unused"), "done");
});
