import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEventStore, FileEventStore } from "@event-scout/db";
import { createRunStats, loadEnv, type AppEnv } from "@event-scout/shared";
import { printLocalRunSummaryIfNeeded } from "./run-scout.js";

function realModeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return { ...loadEnv({ MOCK_MODE: "false", LLM_PROVIDER: "openai", LLM_API_KEY: "test-key" }), ...overrides };
}

function withTempFileStore(run: (store: FileEventStore, dataDir: string) => void): void {
  const dataDir = mkdtempSync(join(tmpdir(), "scout-run-summary-"));
  try {
    run(new FileEventStore(realModeEnv(), { dataDir }), dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function captureConsoleLog(run: () => void): string[] {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

/**
 * printLocalRunSummaryIfNeeded only prints in `pretty` mode (CI/Trigger.dev/log pipelines run in
 * `json` mode and shouldn't get stray non-JSON lines). Tests force the format explicitly rather
 * than relying on whatever TTY/CI state happens to be true wherever `pnpm test` runs.
 */
function withLogFormat<T>(format: "pretty" | "json", run: () => T): T {
  const original = process.env.LOG_FORMAT;
  process.env.LOG_FORMAT = format;
  try {
    return run();
  } finally {
    if (original === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = original;
  }
}

test("printLocalRunSummaryIfNeeded prints candidates -> events -> recommendations, where results are stored, and the admin hint", () => {
  withLogFormat("pretty", () => {
    withTempFileStore((store, dataDir) => {
      const stats = createRunStats({ mockMode: false, candidatesFound: 12, eventsExtracted: 5, recommendationsCreated: 2 });
      const lines = captureConsoleLog(() => printLocalRunSummaryIfNeeded(realModeEnv(), store, stats));
      const printed = lines.join("\n");

      assert.match(printed, /12 candidates -> 5 events -> 2 recommendations/);
      assert.match(printed, new RegExp(escapeRegExp(dataDir)), "should name the directory the data was stored in");
      assert.match(printed, /pnpm admin/, "should point the user at the admin dashboard");
    });
  });
});

test("printLocalRunSummaryIfNeeded uses singular units for a count of one", () => {
  withLogFormat("pretty", () => {
    withTempFileStore((store) => {
      const stats = createRunStats({ mockMode: false, candidatesFound: 1, eventsExtracted: 1, recommendationsCreated: 1 });
      const printed = captureConsoleLog(() => printLocalRunSummaryIfNeeded(realModeEnv(), store, stats)).join("\n");
      assert.match(printed, /1 candidate -> 1 event -> 1 recommendation(?!s)/);
    });
  });
});

test("printLocalRunSummaryIfNeeded prints a what-next hint in mock mode when pretty", () => {
  withLogFormat("pretty", () => {
    withTempFileStore((store) => {
      const env = loadEnv({ MOCK_MODE: "true" });
      const stats = createRunStats({ mockMode: true, candidatesFound: 8, eventsExtracted: 3, recommendationsCreated: 1 });
      const printed = captureConsoleLog(() => printLocalRunSummaryIfNeeded(env, store, stats)).join("\n");

      assert.match(printed, /8 candidates -> 3 events -> 1 recommendation(?!s)/);
      assert.match(printed, /pnpm admin/, "should point the user at the admin dashboard");
      assert.match(printed, /pnpm onboard/, "should point the user at setting up real API keys");
    });
  });
});

test("printLocalRunSummaryIfNeeded stays silent in mock mode when LOG_FORMAT is json", () => {
  withLogFormat("json", () => {
    withTempFileStore((store) => {
      const env = loadEnv({ MOCK_MODE: "true" });
      const lines = captureConsoleLog(() => printLocalRunSummaryIfNeeded(env, store, createRunStats()));
      assert.deepEqual(lines, []);
    });
  });
});

test("printLocalRunSummaryIfNeeded stays silent for a real local file store run when LOG_FORMAT is json", () => {
  withLogFormat("json", () => {
    withTempFileStore((store) => {
      const lines = captureConsoleLog(() => printLocalRunSummaryIfNeeded(realModeEnv(), store, createRunStats()));
      assert.deepEqual(lines, []);
    });
  });
});

test("printLocalRunSummaryIfNeeded stays silent when a database is configured", () => {
  withLogFormat("pretty", () => {
    withTempFileStore((store) => {
      const env = realModeEnv({ databaseUrl: "postgres://example/db" });
      const lines = captureConsoleLog(() => printLocalRunSummaryIfNeeded(env, store, createRunStats()));
      assert.deepEqual(lines, []);
    });
  });
});

test("printLocalRunSummaryIfNeeded stays silent for stores that are not the local file store", () => {
  withLogFormat("pretty", () => {
    const mockStore = createEventStore(loadEnv({ MOCK_MODE: "true" }));
    const lines = captureConsoleLog(() => printLocalRunSummaryIfNeeded(realModeEnv(), mockStore, createRunStats()));
    assert.deepEqual(lines, []);
  });
});

test("printLocalRunSummaryIfNeeded explains a real run without an LLM", () => {
  withLogFormat("pretty", () => {
    const env = loadEnv({ MOCK_MODE: "false" });
    const lines = captureConsoleLog(() => {
      printLocalRunSummaryIfNeeded(env, createEventStore(loadEnv({ MOCK_MODE: "true" })), createRunStats({ candidatesFound: 12 }));
    });
    const printed = lines.join("\n");
    assert.match(printed, /12 candidates -> 0 events -> 0 recommendations/);
    assert.match(printed, /No LLM is configured/);
    assert.match(printed, /pnpm onboard/);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
