/**
 * The shared logger has two output formats:
 *
 * - `json`: one `JSON.stringify`d object per line (`level`, `scope`, `message`, `time`, plus
 *   whatever fields the caller passed). This is what Trigger.dev's log capture, CI, and any log
 *   pipeline should keep seeing — untouched, at every level, forever.
 * - `pretty`: a short human line meant for a developer's terminal: `[scope] LEVEL? message
 *   key=value ...`. Debug-level lines are hidden here unless `LOG_LEVEL=debug`. Nested
 *   objects/arrays are summarized rather than dumped so one bad field can't flood the screen.
 *
 * See `getLogFormat`/`getLogLevel` for the selection rules.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "pretty" | "json";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const LOG_FORMATS: readonly LogFormat[] = ["pretty", "json"];
const LOG_LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * `LOG_FORMAT=pretty|json` wins when set. Otherwise: pretty when stdout is a TTY and we're not
 * inside a Trigger.dev run or CI (`CI` env var) — JSON everywhere else, since that's what gets
 * consumed by machines rather than read live by a person.
 *
 * Reads `process.env`/`process.stdout.isTTY` fresh on every call (no caching) so tests — and a
 * long-lived process whose environment changes — see the current answer.
 */
export function getLogFormat(): LogFormat {
  const explicit = normalizeEnumEnv(process.env.LOG_FORMAT, LOG_FORMATS);
  if (explicit) return explicit;

  const isTTY = Boolean(process.stdout.isTTY);
  const isCI = Boolean(process.env.CI);
  return isTTY && !isCI && !isInsideTriggerDotDevRun() ? "pretty" : "json";
}

/** `LOG_LEVEL` threshold for `pretty` mode (default `info`, so debug lines are hidden). */
export function getLogLevel(): LogLevel {
  return normalizeEnumEnv(process.env.LOG_LEVEL, LOG_LEVELS) ?? "info";
}

/**
 * trigger.dev forks a dedicated child process to run task code — for `trigger dev` locally and
 * for deployed managed runs alike — and stamps that child with this variable (see
 * `trigger.dev`'s `executions/taskRunProcess.js`). It's the cheapest reliable, SDK-free signal
 * that logs are being captured by Trigger's own pipeline rather than a plain local invocation,
 * without packages/shared having to depend on `@trigger.dev/sdk`.
 */
export function isInsideTriggerDotDevRun(): boolean {
  return Boolean(process.env.TRIGGER_PROCESS_FORK_START_TIME);
}

function normalizeEnumEnv<T extends string>(raw: string | undefined, allowed: readonly T[]): T | undefined {
  const value = raw?.trim().toLowerCase();
  return allowed.find((candidate) => candidate === value);
}

export function createLogger(scope: string): Logger {
  function write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (getLogFormat() === "pretty") {
      if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[getLogLevel()]) return;
      emit(level, formatPrettyLine({ level, scope, message, fields }));
      return;
    }

    // JSON mode never filters by level: it's the format used by Trigger.dev, CI, and log
    // pipelines, and none of them should lose data because a local terminal wanted less of it.
    const payload = {
      level,
      scope,
      message,
      time: new Date().toISOString(),
      ...fields
    };
    emit(level, JSON.stringify(payload));
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields)
  };
}

function emit(level: LogLevel, line: string): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  fields?: Record<string, unknown>;
}

const MAX_STRING_LENGTH = 100;
const MAX_INLINE_ARRAY_ITEMS = 6;
const MAX_INLINE_ARRAY_LENGTH = 80;

/** Pure formatter behind `pretty` mode — exported so tests can check its rendering directly. */
export function formatPrettyLine(entry: LogEntry): string {
  const segments = [`[${entry.scope}]`];
  if (entry.level === "warn" || entry.level === "error") {
    segments.push(levelTag(entry.level));
  }
  segments.push(entry.message);

  const fields = renderFields(entry.fields);
  if (fields) segments.push(fields);

  return segments.join(" ");
}

function levelTag(level: "warn" | "error"): string {
  const label = level.toUpperCase();
  // Only color when the stream it lands on is a real terminal, so piped/captured output (and
  // every test) sees plain text.
  if (!process.stderr.isTTY) return label;
  const color = level === "error" ? "[31m" : "[33m"; // red / yellow
  return `${color}[1m${label}[0m`;
}

function renderFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return "";
  const rendered: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const renderedValue = renderValue(value);
    if (renderedValue !== undefined) rendered.push(`${key}=${renderedValue}`);
  }
  return rendered.join(" ");
}

function renderValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return renderStringValue(value);
  if (value instanceof Date) return renderStringValue(value.toISOString());
  if (value instanceof Error) return renderStringValue(value.message);
  if (Array.isArray(value)) return renderArrayValue(value);
  if (typeof value === "object") return renderObjectValue(value as Record<string, unknown>);
  return renderStringValue(String(value));
}

function renderStringValue(raw: string): string {
  const truncated = truncate(raw, MAX_STRING_LENGTH);
  return needsQuoting(truncated) ? quote(truncated) : truncated;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function needsQuoting(value: string): boolean {
  return value.length === 0 || /[\s"=]/.test(value);
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Arrays/objects are always summarized, never dumped in full — a `quality={…}`-style blob can
 * carry kilobytes of nested detail. Short arrays of primitives are the one exception: things
 * like `qualityFlags` are exactly the compact, actionable detail pretty mode should surface, so
 * they render inline when they clearly won't flood the line.
 */
function renderArrayValue(value: unknown[]): string {
  if (value.length === 0) return "[]";

  if (value.every(isPrimitiveArrayItem)) {
    const inline = `[${value.map(renderPrimitiveForArray).join(", ")}]`;
    if (value.length <= MAX_INLINE_ARRAY_ITEMS && inline.length <= MAX_INLINE_ARRAY_LENGTH) {
      return inline;
    }
  }
  return `[${value.length}]`;
}

function isPrimitiveArrayItem(item: unknown): item is string | number | boolean | null {
  return item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean";
}

function renderPrimitiveForArray(item: string | number | boolean | null): string {
  if (item === null) return "null";
  return typeof item === "string" ? renderStringValue(item) : String(item);
}

function renderObjectValue(value: Record<string, unknown>): string {
  return Object.keys(value).length === 0 ? "{}" : "{…}";
}
