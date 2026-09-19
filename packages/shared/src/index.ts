import { readFileSync } from "node:fs";
import { parseEnvFile } from "./env-file.js";
import { resolveLlmConfig, type LlmConfig } from "./llm-config.js";
import { DEFAULT_PROFILE, findUpPath, loadProfile, type ScoutProfile } from "./profile.js";

export * from "./cli-flags.js";
export * from "./doctor.js";
export * from "./env-file.js";
export * from "./llm-config.js";
export * from "./logger.js";
export * from "./main-module.js";
export * from "./profile.js";
export * from "./profile-files.js";
export * from "./profile-summary.js";
export * from "./repo-root.js";
export * from "./timeout.js";

export type RunType = "daily" | "miss_hunt" | "manual";
export type RunStatus = "running" | "succeeded" | "failed";
export type ScanMode = "full" | "light";

export type SourcePlatform =
  | "exa"
  | "x"
  | "luma"
  | "meetup"
  | "eventbrite"
  | "linkedin_indexed"
  | "firecrawl"
  | "manual"
  | "web"
  | "mock";

export type CandidateStatus = "new" | "fetched" | "extracted" | "rejected" | "error";
export type LocationPrecision = "exact" | "neighborhood" | "city_only" | "unknown";
export type RegistrationStatus = "open" | "approval_required" | "sold_out" | "closed" | "unknown";
export type EventType =
  | "dinner"
  | "breakfast"
  | "happy_hour"
  | "demo"
  | "salon"
  | "panel"
  | "conference"
  | "workshop"
  | "online"
  | "other";

export type NextAction = "apply" | "rsvp" | "ask_intro" | "monitor" | "skip";
export type FeedbackType =
  | "good"
  | "bad"
  | "very_my_type"
  | "too_generic"
  | "too_far"
  | "want_intro"
  | "not_relevant";

export interface CandidateUrl {
  id: string;
  runId: string;
  url: string;
  canonicalUrl: string;
  sourcePlatform: SourcePlatform;
  sourceQuery?: string;
  sourceId?: string;
  title?: string;
  snippet?: string;
  discoveredAt: string;
  status: CandidateStatus;
  rejectionReason?: string;
}

export interface RawCandidate {
  sourceUrl: string;
  url?: string;
  canonicalUrl?: string;
  runId?: string;
  title: string;
  snippet: string;
  id: string;
  sourcePlatform: SourcePlatform;
  sourceQuery?: string;
  sourceId?: string;
  discoveredAt: string;
  status?: CandidateStatus;
  rejectionReason?: string;
  evidence: string[];
}

export interface EventCandidate {
  id: string;
  runId?: string;
  canonicalUrl: string;
  sourceUrls: string[];
  sourcePlatforms?: SourcePlatform[];
  title: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  city?: string;
  venueText?: string;
  locationPrecision: LocationPrecision;
  hosts: string[];
  organizers?: string[];
  platforms?: string[];
  visibilityFlags: string[];
  registrationStatus?: RegistrationStatus;
  eventType?: EventType;
  confidence?: number;
  status?: RegistrationStatus;
  score?: number;
  /** Component scores and action from the scorer, when the event was scored this run. */
  scoreBreakdown?: EventScoreBreakdown;
  reasons?: string[];
  risks?: string[];
}

export interface EventScoreBreakdown {
  userFit: number;
  roomQuality: number;
  networkingValue: number;
  timeliness: number;
  locationActionability: number;
  novelty: number;
  evidenceConfidence: number;
  nextAction: NextAction;
}

export interface EventWindowOptions {
  now?: Date;
  monthsAhead?: number;
}

export type EventWindowRejectionReason = "missing_date" | "invalid_date" | "past_event" | "too_far_future";

export interface EventScore {
  eventId?: string;
  totalScore?: number;
  userFit?: number;
  roomQuality?: number;
  networkingValue?: number;
  timeliness?: number;
  locationActionability?: number;
  novelty?: number;
  evidenceConfidence?: number;
  penalties?: string[];
  shouldRecommend?: boolean;
  rationale?: string;
  nextAction?: NextAction;
  score?: number;
  reasons?: string[];
  risks?: string[];
}

export interface Recommendation {
  id: string;
  runId: string;
  eventId: string;
  score: number;
  reason: string;
  createdAt: string;
}

export interface ScoutRun {
  id: string;
  runType: RunType;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  error?: string;
  stats: RunStats;
}

export interface RunStats {
  candidatesFound: number;
  pagesInspected: number;
  eventsExtracted: number;
  scoresCreated: number;
  recommendationsCreated: number;
  rejectedCandidates: number;
  mockMode: boolean;
  scanMode: ScanMode;
  xEnabled: boolean;
  xPostsRead: number;
  xBudgetRemaining: number;
  /** Extraction and scoring detail, recorded by real scans for the dashboard's Health tab. */
  extractionCandidatesAttempted?: number;
  extractionCandidatesLimit?: number;
  extractionConcurrency?: number;
  extractionStoppedByTimeBudget?: boolean;
  firecrawlPagesUsed?: number;
  rawEventsExtracted?: number;
  dedupedEventsExtracted?: number;
  futureWindowEvents?: number;
  dateWindowRejected?: Record<string, number>;
  scoringEventsAttempted?: number;
  scoringEventsLimit?: number;
  scoringConcurrency?: number;
  scoringStoppedByTimeBudget?: boolean;
}

/**
 * Spending presets for one scan, selected with SCOUT_BUDGET. Each sets the default for the
 * matching MAX_* variable; any MAX_* variable that is set still wins. See docs/setup-and-costs.md
 * for what each costs. Unset means "large", the limits this project has always run with.
 */
export const SCOUT_BUDGETS = {
  small: { exaSearches: 10, xPostsPerDay: 25, firecrawlPages: 10, llmExtractions: 15, llmScores: 10 },
  medium: { exaSearches: 20, xPostsPerDay: 50, firecrawlPages: 15, llmExtractions: 25, llmScores: 15 },
  large: { exaSearches: 40, xPostsPerDay: 150, firecrawlPages: 60, llmExtractions: 40, llmScores: 25 }
} as const;

export type ScoutBudgetName = keyof typeof SCOUT_BUDGETS;

export function resolveScoutBudget(value: string | undefined): ScoutBudgetName {
  const name = value?.trim().toLowerCase();
  if (!name) return "large";
  if (name in SCOUT_BUDGETS) return name as ScoutBudgetName;
  throw new Error(`SCOUT_BUDGET=${value} is not one of: ${Object.keys(SCOUT_BUDGETS).join(", ")}.`);
}

export interface BudgetCaps {
  /** The SCOUT_BUDGET preset the defaults below came from. */
  preset?: ScoutBudgetName;
  maxExaSearchesPerRun: number;
  maxAgentGeneratedExaQueries?: number;
  maxAgentGeneratedXQueries?: number;
  maxExplorationBudgetPercent?: number;
  maxXPostsPerRun: number;
  maxXPostsPerDay: number;
  maxFirecrawlPagesPerRun: number;
  maxLlmExtractCandidatesPerRun: number;
  /** Event pages read at the same time (MAX_LLM_EXTRACT_CONCURRENCY, default 4). */
  maxLlmExtractConcurrency?: number;
  maxLlmScoreEventsPerRun: number;
  /** Events scored at the same time (MAX_LLM_SCORE_CONCURRENCY, default 4). */
  maxLlmScoreConcurrency?: number;
  maxLlmScoreEventPercent?: number;
  maxRecommendationsPerRun: number;
}

export interface TimeoutCaps {
  exaMs: number;
  xMs: number;
  firecrawlMs: number;
  pageFetchMs: number;
  llmMs: number;
  telegramMs: number;
  postgresConnectionMs: number;
  postgresQueryMs: number;
}

export interface AppEnv {
  mockMode: boolean;
  databaseUrl?: string;
  /** Overrides where the local file store (used in real mode without DATABASE_URL) keeps its data. */
  scoutDataDir?: string;
  triggerSecretKey?: string;
  exaApiKey?: string;
  xBearerToken?: string;
  firecrawlApiKey?: string;
  llm: LlmConfig;
  /** Preferences that drive discovery, filtering, scoring, and thresholds. */
  profile: ScoutProfile;
  /** Short label for where the profile came from, e.g. "profiles/fintech.yaml" or "built-in default". */
  profileSource: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  appBaseUrl?: string;
  adminUsername?: string;
  adminPassword?: string;
  adminPort: number;
  scanSchedules: string[];
  xScanSchedules: string[];
  budgets: BudgetCaps;
  timeouts: TimeoutCaps;
}

const DEFAULT_STATS: RunStats = {
  candidatesFound: 0,
  pagesInspected: 0,
  eventsExtracted: 0,
  scoresCreated: 0,
  recommendationsCreated: 0,
  rejectedCandidates: 0,
  mockMode: true,
  scanMode: "light",
  xEnabled: false,
  xPostsRead: 0,
  xBudgetRemaining: 0
};

function stringValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function numberValue(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = stringValue(env, key);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative number`);
  }

  return parsed;
}

export interface LoadEnvOptions {
  profile?: ScoutProfile;
  profileSource?: string;
}

export function loadEnv(env: NodeJS.ProcessEnv, options: LoadEnvOptions = {}): AppEnv {
  const budgetPreset = resolveScoutBudget(env.SCOUT_BUDGET);
  const budget = SCOUT_BUDGETS[budgetPreset];
  const maxExaSearchesPerRun = numberValue(env, "MAX_EXA_SEARCHES_PER_RUN", budget.exaSearches);
  const maxXPostsPerDay = numberValue(env, "MAX_X_POSTS_PER_DAY", budget.xPostsPerDay);
  const maxXPostsPerRun = numberValue(env, "MAX_X_POSTS_PER_RUN", maxXPostsPerDay);

  return {
    mockMode: env.MOCK_MODE !== "false",
    databaseUrl: stringValue(env, "DATABASE_URL"),
    scoutDataDir: stringValue(env, "SCOUT_DATA_DIR"),
    triggerSecretKey: stringValue(env, "TRIGGER_SECRET_KEY"),
    exaApiKey: stringValue(env, "EXA_API_KEY"),
    xBearerToken: stringValue(env, "X_BEARER_TOKEN"),
    firecrawlApiKey: stringValue(env, "FIRECRAWL_API_KEY"),
    llm: resolveLlmConfig(env),
    profile: options.profile ?? DEFAULT_PROFILE,
    profileSource: options.profileSource ?? (options.profile ? `profile ${options.profile.name}` : `built-in default (${DEFAULT_PROFILE.name})`),
    telegramBotToken: stringValue(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: stringValue(env, "TELEGRAM_CHAT_ID"),
    appBaseUrl: stringValue(env, "APP_BASE_URL"),
    adminUsername: stringValue(env, "ADMIN_USERNAME"),
    adminPassword: stringValue(env, "ADMIN_PASSWORD"),
    adminPort: numberValue(env, "ADMIN_PORT", 4310),
    scanSchedules: listValue(env, "SCAN_SCHEDULES", ["09:00", "14:00", "22:00"]),
    xScanSchedules: listValue(env, "X_SCAN_SCHEDULES", ["09:00"]),
    budgets: {
      preset: budgetPreset,
      maxExaSearchesPerRun,
      maxAgentGeneratedExaQueries: numberValue(env, "MAX_AGENT_GENERATED_EXA_QUERIES", Math.floor(maxExaSearchesPerRun / 2)),
      maxAgentGeneratedXQueries: numberValue(env, "MAX_AGENT_GENERATED_X_QUERIES", 0),
      maxExplorationBudgetPercent: numberValue(env, "MAX_EXPLORATION_BUDGET_PERCENT", 50),
      maxXPostsPerRun,
      maxXPostsPerDay,
      maxFirecrawlPagesPerRun: numberValue(env, "MAX_FIRECRAWL_PAGES_PER_RUN", budget.firecrawlPages),
      maxLlmExtractCandidatesPerRun: numberValue(env, "MAX_LLM_EXTRACT_CANDIDATES_PER_RUN", budget.llmExtractions),
      maxLlmExtractConcurrency: numberValue(env, "MAX_LLM_EXTRACT_CONCURRENCY", 4),
      maxLlmScoreEventsPerRun: numberValue(env, "MAX_LLM_SCORE_EVENTS_PER_RUN", budget.llmScores),
      maxLlmScoreConcurrency: numberValue(env, "MAX_LLM_SCORE_CONCURRENCY", 4),
      maxLlmScoreEventPercent: numberValue(env, "MAX_LLM_SCORE_EVENT_PERCENT", 30),
      maxRecommendationsPerRun: numberValue(env, "MAX_RECOMMENDATIONS_PER_RUN", 10)
    },
    timeouts: {
      exaMs: numberValue(env, "EXA_TIMEOUT_MS", 20_000),
      xMs: numberValue(env, "X_TIMEOUT_MS", 20_000),
      firecrawlMs: numberValue(env, "FIRECRAWL_TIMEOUT_MS", 20_000),
      pageFetchMs: numberValue(env, "PAGE_FETCH_TIMEOUT_MS", 15_000),
      llmMs: numberValue(env, "LLM_TIMEOUT_MS", numberValue(env, "QWEN_TIMEOUT_MS", 45_000)),
      telegramMs: numberValue(env, "TELEGRAM_TIMEOUT_MS", 15_000),
      postgresConnectionMs: numberValue(env, "POSTGRES_CONNECTION_TIMEOUT_MS", 10_000),
      postgresQueryMs: numberValue(env, "POSTGRES_QUERY_TIMEOUT_MS", 30_000)
    }
  };
}

function listValue(env: NodeJS.ProcessEnv, key: string, fallback: string[]): string[] {
  const raw = stringValue(env, key);
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Loads `.env.local` (shell variables win) and the scout profile
 * (SCOUT_PROFILE, then scout.profile.yaml, then the built-in default).
 */
export function loadRuntimeEnv(cwd = process.cwd(), env = process.env): AppEnv {
  const localPath = findUpPath(cwd, ".env.local");
  const localValues = localPath ? parseEnvFile(readFileSync(localPath, "utf8")) : {};
  const merged = { ...localValues, ...env };
  exportProcessSettings(localValues, env);
  const { profile, source } = loadProfile({ cwd, env: merged });
  return loadEnv(merged, { profile, profileSource: source });
}

/** Settings read straight from process.env (e.g. by the logger) that may also live in .env.local. */
const PROCESS_SETTINGS = ["LOG_FORMAT", "LOG_LEVEL"] as const;

/** Copies process-level settings from .env.local into the environment unless the shell already set them. */
export function exportProcessSettings(localValues: NodeJS.ProcessEnv, target: NodeJS.ProcessEnv = process.env): void {
  for (const key of PROCESS_SETTINGS) {
    const value = localValues[key]?.trim();
    if (value && target[key] === undefined) target[key] = value;
  }
}


export function requireRealModeValue(value: string | undefined, key: string, env: AppEnv): string {
  if (value) return value;
  if (env.mockMode) return "";
  throw new Error(`${key} is required when MOCK_MODE=false`);
}

export function createRunStats(partial: Partial<RunStats> = {}): RunStats {
  return { ...DEFAULT_STATS, ...partial };
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs: number,
  label: string
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetchImpl(input, init);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromUpstream = (): void => controller.abort();
  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["ref", "ref_src", "fbclid", "gclid"].includes(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

export function normalizeRawCandidate(candidate: RawCandidate, runId: string): CandidateUrl {
  const url = candidate.url || candidate.sourceUrl;
  return {
    id: candidate.id,
    runId,
    url,
    canonicalUrl: candidate.canonicalUrl || canonicalizeUrl(url),
    sourcePlatform: candidate.sourcePlatform,
    sourceQuery: candidate.sourceQuery,
    sourceId: candidate.sourceId,
    title: candidate.title,
    snippet: candidate.snippet,
    discoveredAt: candidate.discoveredAt,
    status: candidate.status || "new",
    rejectionReason: candidate.rejectionReason
  };
}

export function filterEventsInFutureWindow<T extends { startAt?: string }>(
  events: T[],
  options: EventWindowOptions = {}
): T[] {
  return events.filter((event) => !classifyEventWindowRejection(event, options));
}

export function isEventInFutureWindow(
  event: { startAt?: string },
  options: EventWindowOptions = {}
): boolean {
  return !classifyEventWindowRejection(event, options);
}

export function classifyEventWindowRejection(
  event: { startAt?: string },
  options: EventWindowOptions = {}
): EventWindowRejectionReason | undefined {
  const now = options.now ?? new Date();
  if (!event.startAt) return "missing_date";

  const startAt = parseEventDate(event.startAt);
  if (!startAt) return "invalid_date";
  if (startAt.getTime() <= now.getTime()) return "past_event";
  if (startAt.getTime() > eventWindowEnd(options).getTime()) return "too_far_future";
  return undefined;
}

export function eventWindowEnd(options: EventWindowOptions = {}): Date {
  return addMonthsClamped(options.now ?? new Date(), options.monthsAhead ?? 1);
}

function parseEventDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

