import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import type { AppEnv, CandidateUrl } from "@event-scout/shared";
import { createRunStats, loadEnv } from "@event-scout/shared";
import { createEventStore, FileEventStore } from "./index.js";
import { resolveScoutDataDir, withFileLock } from "./file-store.js";

function realModeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return { ...loadEnv({ MOCK_MODE: "false" }), ...overrides };
}

function withTempDir(run: (dataDir: string) => void | Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "scout-file-store-"));
  return Promise.resolve(run(dataDir)).finally(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });
}

function candidateFixture(overrides: Partial<CandidateUrl> = {}): CandidateUrl {
  return {
    id: "candidate-1",
    runId: "run-1",
    url: "https://lu.ma/some-dinner",
    canonicalUrl: "https://lu.ma/some-dinner",
    sourcePlatform: "luma",
    discoveredAt: new Date().toISOString(),
    status: "new",
    ...overrides
  };
}

test("resolveScoutDataDir honors an absolute SCOUT_DATA_DIR override", () => {
  const dir = resolveScoutDataDir("/tmp/custom-scout-data", process.cwd());
  assert.equal(dir, "/tmp/custom-scout-data");
});

test("resolveScoutDataDir resolves a relative SCOUT_DATA_DIR against the workspace root, not cwd", () => {
  const fromRoot = resolveScoutDataDir("custom-dir", process.cwd());
  const fromNestedCwd = resolveScoutDataDir("custom-dir", join(process.cwd(), "apps", "worker"));
  assert.ok(isAbsolute(fromRoot));
  assert.equal(fromRoot, fromNestedCwd, "worker and admin must resolve the same data directory");
  assert.ok(fromRoot.endsWith(join("custom-dir")));
});

test("resolveScoutDataDir defaults to .scout-data under the workspace root", () => {
  const dir = resolveScoutDataDir(undefined, process.cwd());
  assert.ok(dir.endsWith(join(".scout-data")));
  assert.ok(isAbsolute(dir));
});

test("resolveScoutDataDir picks up SCOUT_DATA_DIR from AppEnv (which itself merges .env.local and the shell)", () => {
  const env = realModeEnv({ scoutDataDir: "/tmp/from-env-local" });
  assert.equal(resolveScoutDataDir(env.scoutDataDir), "/tmp/from-env-local");
});

test("FileEventStore persists data so a fresh instance reads what an earlier instance wrote", async () => {
  await withTempDir(async (dataDir) => {
    const env = realModeEnv();

    const writer = new FileEventStore(env, { dataDir });
    const run = await writer.createRun("manual");
    await writer.saveCandidateUrls(run.id, [candidateFixture({ runId: run.id })]);
    await writer.saveEvents([{
      id: "event-1",
      runId: run.id,
      canonicalUrl: "https://lu.ma/some-dinner",
      sourceUrls: ["https://lu.ma/some-dinner"],
      title: "Some Founder Dinner",
      locationPrecision: "city_only",
      hosts: ["Some Host"],
      visibilityFlags: [],
      score: 82
    }]);
    await writer.saveEventScores(run.id, [{ eventId: "event-1", totalScore: 82, score: 82 }]);
    await writer.saveRecommendations(run.id, [{
      id: "rec-1",
      runId: run.id,
      eventId: "event-1",
      score: 82,
      reason: "Strong fit",
      createdAt: new Date().toISOString()
    }]);
    await writer.finishRun(run.id, createRunStats({ mockMode: false, candidatesFound: 1, eventsExtracted: 1 }));
    await writer.close?.();

    const reader = new FileEventStore(env, { dataDir });
    const runs = await reader.listRuns();
    const events = await reader.listEvents();
    const recommendations = await reader.listRecommendations();
    const scores = await reader.listEventScores();

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.id, run.id);
    assert.equal(runs[0]?.status, "succeeded");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.title, "Some Founder Dinner");
    assert.equal(recommendations.length, 1);
    assert.equal(scores.length, 1);
  });
});

test("FileEventStore reloads changes made by another live instance before the next read (no restart needed)", async () => {
  await withTempDir(async (dataDir) => {
    const env = realModeEnv();
    const admin = new FileEventStore(env, { dataDir });
    assert.deepEqual(await admin.listRuns(), [], "starts empty before any scan has run");

    const worker = new FileEventStore(env, { dataDir });
    const run = await worker.createRun("manual");
    await worker.finishRun(run.id, createRunStats({ mockMode: false }));

    const runsSeenByAdmin = await admin.listRuns();
    assert.equal(runsSeenByAdmin.length, 1, "a second, already-open store instance should pick up the new run on its next read");
    assert.equal(runsSeenByAdmin[0]?.id, run.id);
  });
});

test("FileEventStore writes atomically: no leftover temp files, and the store file is always valid JSON", async () => {
  await withTempDir(async (dataDir) => {
    const env = realModeEnv();
    const store = new FileEventStore(env, { dataDir });
    await store.createRun("manual");
    await store.createRun("manual");

    const files = readdirSync(dataDir);
    const leftoverTempFiles = files.filter((file) => file.includes(".tmp"));
    assert.deepEqual(leftoverTempFiles, [], "no partial/temp files should remain after writes settle");

    const storeFile = files.find((file) => file.endsWith(".json"));
    assert.ok(storeFile, "expected a JSON store file to exist");
    const raw = readFileSync(join(dataDir, storeFile as string), "utf8");
    assert.doesNotThrow(() => JSON.parse(raw));
  });
});

test("FileEventStore caps stored runs (and their candidates) to the retention window", async () => {
  await withTempDir(async (dataDir) => {
    const env = realModeEnv();
    const store = new FileEventStore(env, { dataDir, retentionRuns: 3 });

    for (let index = 0; index < 5; index += 1) {
      const run = await store.createRun("manual");
      await store.saveCandidateUrls(run.id, [candidateFixture({ id: `candidate-${index}`, runId: run.id })]);
      await store.finishRun(run.id, createRunStats({ mockMode: false }));
    }

    const runs = await store.listRuns(100);
    const candidates = await store.listCandidateUrls({ limit: 100 });
    assert.equal(runs.length, 3, "only the newest 3 runs should be kept");
    assert.equal(candidates.length, 3, "candidates belonging to pruned runs should be dropped too");
  });
});

test("FileEventStore never seeds mock data", async () => {
  await withTempDir(async (dataDir) => {
    const store = new FileEventStore(realModeEnv(), { dataDir });
    assert.deepEqual(await store.listRuns(), []);
    assert.deepEqual(await store.listEvents(), []);
    assert.deepEqual(await store.listRecommendations(), []);
  });
});

test("createEventStore only seeds mock data in mock mode, never in real mode without a database", async () => {
  const mockStore = createEventStore(loadEnv({ MOCK_MODE: "true" }));
  const mockEvents = await mockStore.listEvents();
  assert.ok(mockEvents.length > 0, "mock mode should still show its seeded sample events");

  await withTempDir(async (dataDir) => {
    const realStore = createEventStore(realModeEnv({ scoutDataDir: dataDir }));
    assert.ok(realStore instanceof FileEventStore, "real mode without DATABASE_URL should fall back to the file store");
    assert.deepEqual(await realStore.listEvents(), [], "real mode must never seed mock fixture events");
    assert.deepEqual(await realStore.listRuns(), [], "real mode must never seed a mock fixture run");
  });
});

test("FileEventStore keeps a copy of an unreadable store file before starting fresh", async () => {
  await withTempDir(async (dataDir) => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "store.json"), "{ not json");
    const store = new FileEventStore(realModeEnv({ scoutDataDir: dataDir }));

    assert.deepEqual(await store.listRuns(), []);
    await store.createRun("manual");
    await store.close?.();

    const backups = readdirSync(dataDir).filter((file) => file.startsWith("store.json.corrupt-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(dataDir, backups[0]!), "utf8"), "{ not json");
    assert.equal((await new FileEventStore(realModeEnv({ scoutDataDir: dataDir })).listRuns()).length, 1);
  });
});

test("FileEventStore surfaces a failed save and keeps saving once the problem is fixed", async () => {
  await withTempDir(async (root) => {
    const dataDir = join(root, "data");
    writeFileSync(dataDir, "a file where the data directory should be");
    const store = new FileEventStore(realModeEnv({ scoutDataDir: dataDir }));

    await assert.rejects(store.createRun("manual"));

    rmSync(dataDir);
    const run = await store.createRun("manual");
    await store.close?.();

    const saved = await new FileEventStore(realModeEnv({ scoutDataDir: dataDir })).listRuns();
    assert.deepEqual(saved.map((item) => item.id), [run.id]);
  });
});

test("FileEventStore does not lose writes when two processes save at the same time", async () => {
  await withTempDir(async (dataDir) => {
    const worker = new FileEventStore(realModeEnv({ scoutDataDir: dataDir }));
    const admin = new FileEventStore(realModeEnv({ scoutDataDir: dataDir }));
    const run = await worker.createRun("manual");

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        index % 2 === 0
          ? worker.saveCandidates([
              candidateFixture({ id: `candidate-${index}`, runId: run.id, url: `https://lu.ma/e-${index}`, canonicalUrl: `https://lu.ma/e-${index}` })
            ])
          : admin.createFeedback({ eventId: `event-${index}`, feedbackType: "good" })
      )
    );
    await worker.close?.();
    await admin.close?.();

    const reader = new FileEventStore(realModeEnv({ scoutDataDir: dataDir }));
    assert.equal((await reader.listCandidateUrls({ limit: 100 })).length, 6);
    assert.equal((await reader.getDashboard()).feedbackSummary.reduce((sum, row) => sum + row.count, 0), 6);
    assert.equal(readdirSync(dataDir).some((file) => file.endsWith(".lock")), false);
  });
});

test("withFileLock clears a lock left behind by a crashed process", async () => {
  await withTempDir(async (dataDir) => {
    const lockPath = join(dataDir, "store.json.lock");
    mkdirSync(lockPath);
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lockPath, old, old);

    const result = await withFileLock(lockPath, async () => "ran", { timeoutMs: 1_000, staleMs: 60_000 });
    assert.equal(result, "ran");
    assert.equal(readdirSync(dataDir).includes("store.json.lock"), false);
  });
});
