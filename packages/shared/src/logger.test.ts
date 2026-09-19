import assert from "node:assert/strict";
import test from "node:test";
import { createLogger, formatPrettyLine, getLogFormat, getLogLevel } from "./logger.js";

const ENV_KEYS = ["LOG_FORMAT", "LOG_LEVEL", "CI", "TRIGGER_PROCESS_FORK_START_TIME"] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, run: () => void): void {
  const original: Partial<Record<string, string | undefined>> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  try {
    for (const key of ENV_KEYS) {
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function withStreamTTY(streams: { stdout?: boolean; stderr?: boolean }, run: () => void): void {
  const originalStdout = process.stdout.isTTY;
  const originalStderr = process.stderr.isTTY;
  try {
    process.stdout.isTTY = streams.stdout ?? originalStdout;
    process.stderr.isTTY = streams.stderr ?? originalStderr;
    run();
  } finally {
    process.stdout.isTTY = originalStdout;
    process.stderr.isTTY = originalStderr;
  }
}

function captureConsole(run: () => void): { logs: string[]; warns: string[]; errors: string[] } {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    run();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  return { logs, warns, errors };
}

// ---- formatPrettyLine: scalars, quoting, truncation, nested summarization ----

test("formatPrettyLine renders scope, message, and scalar fields as key=value", () => {
  const line = formatPrettyLine({
    level: "info",
    scope: "worker:scout",
    message: "run started",
    fields: { runId: "run_1", mockMode: true, candidatesFound: 12 }
  });
  assert.equal(line, "[worker:scout] run started runId=run_1 mockMode=true candidatesFound=12");
});

test("formatPrettyLine shows a level tag only for warn and error", () => {
  withStreamTTY({ stderr: false }, () => {
    const build = (level: "debug" | "info" | "warn" | "error") =>
      formatPrettyLine({ level, scope: "svc", message: "thing happened" });

    assert.equal(build("debug"), "[svc] thing happened");
    assert.equal(build("info"), "[svc] thing happened");
    assert.equal(build("warn"), "[svc] WARN thing happened");
    assert.equal(build("error"), "[svc] ERROR thing happened");
  });
});

test("formatPrettyLine colors the level tag only when stderr is a real terminal", () => {
  withStreamTTY({ stderr: true }, () => {
    const line = formatPrettyLine({ level: "error", scope: "svc", message: "boom" });
    assert.match(line, /\[31m\[1mERROR\[0m/);
  });
  withStreamTTY({ stderr: false }, () => {
    const line = formatPrettyLine({ level: "error", scope: "svc", message: "boom" });
    assert.equal(line, "[svc] ERROR boom");
  });
});

test("formatPrettyLine quotes strings only when they need it", () => {
  const line = formatPrettyLine({
    level: "info",
    scope: "svc",
    message: "m",
    fields: { safe: "consumer-ai-founder", spaced: "needs quoting", withEquals: "a=b", empty: "" }
  });
  assert.equal(line, '[svc] m safe=consumer-ai-founder spaced="needs quoting" withEquals="a=b" empty=""');
});

test("formatPrettyLine truncates long string values", () => {
  const long = "a".repeat(150);
  const line = formatPrettyLine({ level: "info", scope: "svc", message: "m", fields: { long } });
  assert.equal(line, `[svc] m long=${"a".repeat(100)}…`);
});

test("formatPrettyLine summarizes nested objects instead of dumping them", () => {
  const line = formatPrettyLine({
    level: "info",
    scope: "svc",
    message: "pipeline quality summary",
    fields: { quality: { a: 1, b: { c: 2 } }, empty: {} }
  });
  assert.equal(line, "[svc] pipeline quality summary quality={…} empty={}");
});

test("formatPrettyLine shows short primitive arrays inline but summarizes larger or nested ones as a count", () => {
  const line = formatPrettyLine({
    level: "info",
    scope: "svc",
    message: "m",
    fields: {
      qualityFlags: ["low_extraction_yield", "high_duplicate_url_rate"],
      empty: [],
      many: Array.from({ length: 10 }, (_, i) => `item${i}`),
      nested: [{ a: 1 }]
    }
  });
  assert.equal(
    line,
    "[svc] m qualityFlags=[low_extraction_yield, high_duplicate_url_rate] empty=[] many=[10] nested=[1]"
  );
});

test("formatPrettyLine omits undefined fields and renders null explicitly", () => {
  const line = formatPrettyLine({ level: "info", scope: "svc", message: "m", fields: { a: undefined, b: null } });
  assert.equal(line, "[svc] m b=null");
});

test("formatPrettyLine renders Date and Error values as short strings, not dumped objects", () => {
  const line = formatPrettyLine({
    level: "info",
    scope: "svc",
    message: "m",
    fields: { when: new Date("2026-01-01T00:00:00.000Z"), err: new Error("boom") }
  });
  assert.equal(line, "[svc] m when=2026-01-01T00:00:00.000Z err=boom");
});

// ---- format selection: LOG_FORMAT, TTY, CI, Trigger.dev detection ----

test("getLogFormat: explicit LOG_FORMAT wins over TTY, CI, and Trigger detection", () => {
  withEnv({ LOG_FORMAT: "pretty", CI: "true" }, () => {
    withStreamTTY({ stdout: false }, () => {
      assert.equal(getLogFormat(), "pretty");
    });
  });
  withEnv({ LOG_FORMAT: "json" }, () => {
    withStreamTTY({ stdout: true }, () => {
      assert.equal(getLogFormat(), "json");
    });
  });
});

test("getLogFormat: an unrecognized LOG_FORMAT value falls back to auto-detection", () => {
  withEnv({ LOG_FORMAT: "yaml" }, () => {
    withStreamTTY({ stdout: true }, () => {
      assert.equal(getLogFormat(), "pretty");
    });
  });
});

test("getLogFormat: pretty on a TTY outside CI and outside a Trigger.dev run", () => {
  withEnv({ LOG_FORMAT: undefined, CI: undefined, TRIGGER_PROCESS_FORK_START_TIME: undefined }, () => {
    withStreamTTY({ stdout: true }, () => {
      assert.equal(getLogFormat(), "pretty");
    });
  });
});

test("getLogFormat: json when stdout is not a TTY", () => {
  withEnv({ LOG_FORMAT: undefined, CI: undefined, TRIGGER_PROCESS_FORK_START_TIME: undefined }, () => {
    withStreamTTY({ stdout: false }, () => {
      assert.equal(getLogFormat(), "json");
    });
  });
});

test("getLogFormat: json on a TTY when CI is set", () => {
  withEnv({ LOG_FORMAT: undefined, CI: "true", TRIGGER_PROCESS_FORK_START_TIME: undefined }, () => {
    withStreamTTY({ stdout: true }, () => {
      assert.equal(getLogFormat(), "json");
    });
  });
});

test("getLogFormat: json on a TTY inside a Trigger.dev run", () => {
  withEnv({ LOG_FORMAT: undefined, CI: undefined, TRIGGER_PROCESS_FORK_START_TIME: "1700000000000" }, () => {
    withStreamTTY({ stdout: true }, () => {
      assert.equal(getLogFormat(), "json");
    });
  });
});

test("getLogLevel: defaults to info, accepts debug, ignores garbage", () => {
  withEnv({ LOG_LEVEL: undefined }, () => assert.equal(getLogLevel(), "info"));
  withEnv({ LOG_LEVEL: "debug" }, () => assert.equal(getLogLevel(), "debug"));
  withEnv({ LOG_LEVEL: "DEBUG" }, () => assert.equal(getLogLevel(), "debug"));
  withEnv({ LOG_LEVEL: "not-a-level" }, () => assert.equal(getLogLevel(), "info"));
});

// ---- createLogger: stderr routing, debug gating, JSON mode left untouched ----

test("createLogger: warn and error go to stderr, debug and info go to stdout, in pretty mode", () => {
  withEnv({ LOG_FORMAT: "pretty" }, () => {
    const logger = createLogger("svc");
    const { logs, warns, errors } = captureConsole(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    });
    // debug is hidden by default (LOG_LEVEL unset); see the dedicated test below for that gating.
    assert.deepEqual(logs, ["[svc] i"]);
    assert.deepEqual(warns, ["[svc] WARN w"]);
    assert.deepEqual(errors, ["[svc] ERROR e"]);
  });
});

test("createLogger: warn and error go to stderr, debug and info go to stdout, in json mode", () => {
  withEnv({ LOG_FORMAT: "json" }, () => {
    const logger = createLogger("svc");
    const { logs, warns, errors } = captureConsole(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    });
    assert.equal(logs.length, 2); // debug + info
    assert.equal(warns.length, 1);
    assert.equal(errors.length, 1);
    assert.equal(JSON.parse(warns[0]!).level, "warn");
    assert.equal(JSON.parse(errors[0]!).level, "error");
  });
});

test("createLogger: pretty mode hides debug lines unless LOG_LEVEL=debug", () => {
  withEnv({ LOG_FORMAT: "pretty", LOG_LEVEL: undefined }, () => {
    const logger = createLogger("svc");
    const { logs } = captureConsole(() => logger.debug("hidden by default", { x: 1 }));
    assert.deepEqual(logs, []);
  });

  withEnv({ LOG_FORMAT: "pretty", LOG_LEVEL: "debug" }, () => {
    const logger = createLogger("svc");
    const { logs } = captureConsole(() => logger.debug("now visible", { x: 1 }));
    assert.deepEqual(logs, ["[svc] now visible x=1"]);
  });
});

test("createLogger: json mode output shape is exactly level/scope/message/time plus fields, in that order", () => {
  withEnv({ LOG_FORMAT: "json" }, () => {
    const logger = createLogger("worker:scout");
    const { logs } = captureConsole(() => logger.info("run started", { runId: "run_1", mockMode: true }));
    const line = logs[0]!;
    assert.equal(line, line.trimEnd());
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), ["level", "scope", "message", "time", "runId", "mockMode"]);
    assert.equal(parsed.level, "info");
    assert.equal(parsed.scope, "worker:scout");
    assert.equal(parsed.message, "run started");
    assert.equal(parsed.runId, "run_1");
    assert.equal(parsed.mockMode, true);
    assert.equal(typeof parsed.time, "string");
  });
});

test("createLogger: json mode never filters by LOG_LEVEL, so Trigger.dev/CI never lose lines", () => {
  withEnv({ LOG_FORMAT: "json", LOG_LEVEL: "error" }, () => {
    const logger = createLogger("svc");
    const { logs, warns, errors } = captureConsole(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    });
    assert.equal(logs.length, 2);
    assert.equal(warns.length, 1);
    assert.equal(errors.length, 1);
  });
});

test("createLogger: nested fields stay fully intact in json mode even when pretty would summarize them", () => {
  withEnv({ LOG_FORMAT: "json" }, () => {
    const logger = createLogger("svc");
    const quality = { deep: { nested: { value: 42 } }, flags: ["a", "b"] };
    const { logs } = captureConsole(() => logger.info("pipeline quality summary", { quality }));
    assert.deepEqual(JSON.parse(logs[0]!).quality, quality);
  });
});

test("LOG_FORMAT and LOG_LEVEL from .env.local reach the logger unless the shell set them", async () => {
  const { exportProcessSettings } = await import("./index.js");
  const target: NodeJS.ProcessEnv = { LOG_LEVEL: "warn" };
  exportProcessSettings({ LOG_FORMAT: "json", LOG_LEVEL: "debug", DATABASE_URL: "postgres://x" }, target);
  assert.equal(target.LOG_FORMAT, "json");
  assert.equal(target.LOG_LEVEL, "warn");
  assert.equal(target.DATABASE_URL, undefined);
});
