import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findUpPath } from "@event-scout/shared";
import type { MemoryState } from "./memory-state.js";

export const SCOUT_DATA_DIR_NAME = ".scout-data";
export const SCOUT_STORE_FILE_NAME = "store.json";
export const DEFAULT_RETENTION_RUNS = 30;
const STATE_FORMAT_VERSION = 1;

/**
 * `.scout-data/` at the workspace root by default, so the worker (run from
 * `apps/worker`) and the admin (run from `apps/admin`) land on the exact same
 * directory. `configuredDataDir` (from `AppEnv.scoutDataDir`, i.e. the
 * `SCOUT_DATA_DIR` setting, already merged from `.env.local` and the shell by
 * `loadRuntimeEnv`) overrides it: an absolute path is used as-is, a relative
 * one is resolved against the workspace root, same as the default.
 */
export function resolveScoutDataDir(configuredDataDir?: string, cwd: string = process.cwd()): string {
  const configured = configuredDataDir?.trim();
  if (configured && isAbsolute(configured)) return configured;

  const workspaceMarker = findUpPath(cwd, "pnpm-workspace.yaml");
  const workspaceRoot = workspaceMarker ? dirname(workspaceMarker) : cwd;
  return resolve(workspaceRoot, configured || SCOUT_DATA_DIR_NAME);
}

interface SerializedState {
  version: number;
  savedAt: string;
  runs: MemoryState["runs"];
  candidates: MemoryState["candidates"];
  events: MemoryState["events"];
  eventSources: MemoryState["eventSources"];
  scores: MemoryState["scores"];
  recommendations: MemoryState["recommendations"];
  feedback: MemoryState["feedback"];
  missedEvents: MemoryState["missedEvents"];
}

/**
 * Keeps the file from growing forever: candidates, events, scores, and
 * recommendations are pruned to whatever is reachable from the newest
 * `retentionRuns` runs. Feedback and miss-hunt rows are not tied to a run, so
 * they are capped by absolute count instead of dropped alongside old runs.
 */
export function applyRetentionCap(state: MemoryState, retentionRuns = DEFAULT_RETENTION_RUNS): void {
  if (retentionRuns > 0 && state.runs.length > retentionRuns) {
    state.runs = state.runs.slice(0, retentionRuns);
  }
  const keptRunIds = new Set(state.runs.map((run) => run.id));

  state.candidates = state.candidates.filter((candidate) => !candidate.runId || keptRunIds.has(candidate.runId));
  const keptCandidateIds = new Set(state.candidates.map((candidate) => candidate.id));

  state.events = state.events.filter((event) => !event.runId || keptRunIds.has(event.runId));
  const keptEventIds = new Set(state.events.map((event) => event.id));

  state.eventSources = state.eventSources.filter(
    (link) => keptCandidateIds.has(link.candidateUrlId) && keptEventIds.has(link.eventId)
  );
  state.scores = state.scores.filter((score) => !score.eventId || keptEventIds.has(score.eventId));
  state.recommendations = state.recommendations.filter((recommendation) => keptRunIds.has(recommendation.runId));

  const maxFeedback = 1000;
  if (state.feedback.length > maxFeedback) {
    // Pushed oldest-first, so the newest rows are at the end.
    state.feedback = state.feedback.slice(-maxFeedback);
  }
  const maxMissedEvents = 200;
  if (state.missedEvents.length > maxMissedEvents) {
    // Unshifted newest-first, so the newest rows are at the start.
    state.missedEvents = state.missedEvents.slice(0, maxMissedEvents);
  }
}

function toSerializedState(state: MemoryState): SerializedState {
  return {
    version: STATE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    runs: state.runs,
    candidates: state.candidates,
    events: state.events,
    eventSources: state.eventSources,
    scores: state.scores,
    recommendations: state.recommendations,
    feedback: state.feedback,
    missedEvents: state.missedEvents
  };
}

/** Replaces the contents of `state`'s arrays in place, tolerating a missing or partial file. */
export function applyLoadedState(state: MemoryState, loaded: unknown): void {
  const data = (loaded && typeof loaded === "object" ? loaded as Partial<SerializedState> : {});
  state.runs = Array.isArray(data.runs) ? data.runs : [];
  state.candidates = Array.isArray(data.candidates) ? data.candidates : [];
  state.events = Array.isArray(data.events) ? data.events : [];
  state.eventSources = Array.isArray(data.eventSources) ? data.eventSources : [];
  state.scores = Array.isArray(data.scores) ? data.scores : [];
  state.recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
  state.feedback = Array.isArray(data.feedback) ? data.feedback : [];
  state.missedEvents = Array.isArray(data.missedEvents) ? data.missedEvents : [];
}

export interface LoadedFile {
  mtimeMs: number;
  raw: string;
}

/** Synchronous read for the constructor path, where `await` is not available. */
export function readStateFileSync(filePath: string): LoadedFile | undefined {
  if (!existsSync(filePath)) return undefined;
  const stats = statSync(filePath);
  return { mtimeMs: stats.mtimeMs, raw: readFileSync(filePath, "utf8") };
}

export async function readStateFile(filePath: string): Promise<LoadedFile | undefined> {
  try {
    const stats = await stat(filePath);
    const raw = await readFile(filePath, "utf8");
    return { mtimeMs: stats.mtimeMs, raw };
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

export function parseStateFile(raw: string, filePath: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    // The next write replaces the file, so keep a copy of the unreadable one first.
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    let backedUp = false;
    try {
      copyFileSync(filePath, backupPath);
      backedUp = true;
    } catch {
      // Best effort: fall through to an empty store either way.
    }
    console.warn(
      `[db:file-store] ${filePath} is not valid JSON; starting from an empty store (${errorMessage(error)}).` +
        (backedUp ? ` The unreadable file was copied to ${backupPath}.` : "")
    );
    return undefined;
  }
}

/** Writes temp-file-then-rename so a reader never observes a half-written file. */
export async function writeStateFileAtomic(filePath: string, state: MemoryState): Promise<{ mtimeMs: number; size: number }> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(toSerializedState(state), null, 2);
  const tempPath = join(dir, `.${SCOUT_STORE_FILE_NAME}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  const stats = await stat(filePath);
  return { mtimeMs: stats.mtimeMs, size: payload.length };
}

export interface FileLockOptions {
  /** Give up waiting after this long and continue without the lock (with a warning). */
  timeoutMs?: number;
  /** A lock older than this is treated as left behind by a crashed process and removed. */
  staleMs?: number;
}

/**
 * Cross-process mutual exclusion using an atomically created lock directory, so the scout
 * and the admin (separate processes) never interleave their read-modify-write cycles.
 */
export async function withFileLock<T>(lockPath: string, run: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 60_000;
  await mkdir(dirname(lockPath), { recursive: true });
  const started = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      await mkdir(lockPath);
      acquired = true;
    } catch (error) {
      if (!isEexist(error)) throw error;
      const age = await lockAgeMs(lockPath);
      if (age !== undefined && age > staleMs) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        console.warn(`[db:file-store] ${lockPath} is still held after ${timeoutMs}ms; continuing without the lock.`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 40));
    }
  }

  try {
    return await run();
  } finally {
    if (acquired) await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function lockAgeMs(lockPath: string): Promise<number | undefined> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs;
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

function isEexist(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
