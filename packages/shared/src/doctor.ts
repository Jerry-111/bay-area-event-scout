import { dirname, relative, resolve, sep } from "node:path";
import { commandHint } from "./cli-flags.js";
import type { BudgetCaps } from "./index.js";
import type { LlmConfig } from "./llm-config.js";
import { describeLlm } from "./llm-config.js";
import { negativeTopics, positiveTopics, type ScoutProfile } from "./profile.js";

/**
 * Pure check-evaluation logic behind `pnpm doctor`. Everything here takes plain values (never
 * touches the filesystem or network) so it can run in tests without a real `.env.local`, profile,
 * or provider. `scripts/doctor.ts` gathers the real values (from `loadRuntimeEnv`, `process.version`,
 * a `node_modules` check, ...) and hands them to `buildDoctorChecks`.
 */

/** "skip" marks something optional that is simply not configured. */
export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckResult {
  status: CheckStatus;
  label: string;
  detail?: string;
}

export interface DoctorInput {
  nodeVersion: string;
  minNodeMajor?: number;
  dependenciesInstalled: boolean;
  envFilePath?: string;
  repoRoot?: string;
  /** Used to show paths as ~/... so pasted output does not reveal the home directory. */
  homeDir?: string;
  mockMode: boolean;
  profileError?: string;
  profileName?: string;
  profileSource?: string;
  llm: LlmConfig;
  exaConfigured: boolean;
  xConfigured: boolean;
  firecrawlConfigured: boolean;
  databaseConfigured: boolean;
  /** Where real runs are stored without a database, e.g. ".scout-data/store.json". */
  localDataPath?: string;
  telegramBotConfigured: boolean;
  telegramChatConfigured: boolean;
  /** Per-scan spending caps (from SCOUT_BUDGET and MAX_*). Omitted in older callers. */
  budgets?: BudgetCaps;
}

const DEFAULT_MIN_NODE_MAJOR = 22;

export function evaluateBudget(budgets: BudgetCaps, mockMode: boolean): CheckResult {
  const preset = budgets.preset ?? "large";
  const caps =
    `up to ${budgets.maxExaSearchesPerRun} web searches, ${budgets.maxLlmExtractCandidatesPerRun} event pages read, ` +
    `and ${budgets.maxLlmScoreEventsPerRun} events scored per scan; ${budgets.maxXPostsPerDay} X posts a day`;
  return {
    status: mockMode ? "skip" : "ok",
    label: "Budget",
    detail: `${preset}: ${caps}${mockMode ? " (mock mode spends nothing)" : ""}. See docs/setup-and-costs.md`
  };
}

export function evaluateNodeVersion(nodeVersion: string, minMajor: number = DEFAULT_MIN_NODE_MAJOR): CheckResult {
  const match = /^v?(\d+)/.exec(nodeVersion.trim());
  const major = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(major)) {
    return { status: "fail", label: "Node.js version", detail: `could not parse "${nodeVersion}"` };
  }
  if (major < minMajor) {
    return {
      status: "fail",
      label: "Node.js version",
      detail: `${nodeVersion} found; this project needs Node.js ${minMajor} or newer`
    };
  }
  return { status: "ok", label: "Node.js version", detail: nodeVersion };
}

export function evaluateDependenciesInstalled(installed: boolean): CheckResult {
  return installed
    ? { status: "ok", label: "Dependencies", detail: "node_modules present" }
    : { status: "fail", label: "Dependencies", detail: "not installed; run `pnpm install`" };
}

/** Shows a path relative to the repo when it is inside it, otherwise with the home directory as ~. */
export function displayPath(path: string, repoRoot?: string, homeDir?: string): string {
  const absolute = resolve(path);
  if (repoRoot) {
    const inside = relative(resolve(repoRoot), absolute);
    if (inside && !inside.startsWith("..") && !inside.startsWith(sep)) return inside;
  }
  if (homeDir) {
    const home = resolve(homeDir);
    if (absolute === home) return "~";
    if (absolute.startsWith(`${home}${sep}`)) return `~${sep}${absolute.slice(home.length + 1)}`;
  }
  return absolute;
}

export function evaluateEnvFileSource(input: { envFilePath?: string; repoRoot?: string; homeDir?: string }): CheckResult {
  if (!input.envFilePath) {
    return {
      status: "ok",
      label: ".env.local",
      detail: `none found; using process environment variables and defaults (run \`${commandHint("onboard")}\` to create one)`
    };
  }

  const fileDir = resolve(dirname(input.envFilePath));
  const shown = displayPath(input.envFilePath, input.repoRoot, input.homeDir);
  const fromRoot = input.repoRoot ? relative(resolve(input.repoRoot), fileDir) : "";
  if (input.repoRoot && fromRoot && !fromRoot.startsWith("..") && !fromRoot.startsWith(sep)) {
    return {
      status: "warn",
      label: ".env.local",
      detail:
        `loaded from ${shown}, not the repo root. Commands started from other folders (the worker, the ` +
        `dashboard) may read a different .env.local. Move it to the repo root, where \`${commandHint("onboard")}\` writes it.`
    };
  }
  if (input.repoRoot && fileDir !== resolve(input.repoRoot)) {
    return {
      status: "warn",
      label: ".env.local",
      detail:
        `loaded from ${shown}, which is OUTSIDE this repo (${displayPath(input.repoRoot, undefined, input.homeDir)}). ` +
        "This happens with nested checkouts or git worktrees and can silently load someone else's " +
        `settings or secrets. Create a .env.local in the repo root (\`${commandHint("onboard")}\`) if that is not what you intended.`
    };
  }

  return { status: "ok", label: ".env.local", detail: `loaded from ${shown}` };
}

export function evaluateMode(mockMode: boolean): CheckResult {
  return mockMode
    ? { status: "ok", label: "Mode", detail: "mock — sample data, no external API calls" }
    : { status: "ok", label: "Mode", detail: "real — will call your configured APIs" };
}

export function evaluateProfile(input: { profileError?: string; profileName?: string; profileSource?: string }): CheckResult {
  if (input.profileError) {
    return { status: "fail", label: "Profile", detail: input.profileError };
  }
  const source = input.profileSource ?? "unknown source";
  return {
    status: "ok",
    label: "Profile",
    detail: source.startsWith("built-in default")
      ? `${input.profileName ?? "unknown"} (built-in default; set SCOUT_PROFILE or create scout.profile.yaml to change it)`
      : `${input.profileName ?? "unknown"} (from ${source})`
  };
}

export function evaluateLlm(llm: LlmConfig, mockMode: boolean): CheckResult {
  if (llm.enabled) {
    const detail = `${llm.provider} — extract:${llm.models.extract} score:${llm.models.score} fast:${llm.models.fast}`;
    return {
      status: "ok",
      label: "LLM",
      detail: llm.legacyQwenEnv
        ? `${detail} (using deprecated QWEN_*/DASHSCOPE_API_KEY variables; switch to LLM_PROVIDER)`
        : detail
    };
  }

  if (mockMode) {
    return {
      status: "skip",
      label: "LLM",
      detail: `not configured (${llm.disabledReason ?? "no provider"}); mock mode does not call an LLM. Run \`${commandHint("onboard")}\` to add one.`
    };
  }
  return {
    status: "fail",
    label: "LLM",
    detail:
      `disabled — ${llm.disabledReason ?? "no provider configured"}; real scans cannot read event pages without one ` +
      `(run \`${commandHint("onboard")}\`, or set LLM_PROVIDER and LLM_API_KEY)`
  };
}

export function evaluateConnector(input: {
  name: string;
  configured: boolean;
  recommended: boolean;
  configuredDetail: string;
  missingDetail: string;
}): CheckResult {
  if (input.configured) {
    return { status: "ok", label: input.name, detail: input.configuredDetail };
  }
  return { status: input.recommended ? "warn" : "skip", label: input.name, detail: input.missingDetail };
}

export function evaluateDiscoveryRequirement(input: {
  exaConfigured: boolean;
  xConfigured: boolean;
  mockMode: boolean;
}): CheckResult {
  if (input.mockMode) {
    return { status: "skip", label: "Discovery (real mode)", detail: "not needed in mock mode" };
  }
  if (input.exaConfigured || input.xConfigured) {
    return { status: "ok", label: "Discovery (real mode)", detail: "at least one discovery connector is configured" };
  }
  return {
    status: "warn",
    label: "Discovery (real mode)",
    detail:
      "no EXA_API_KEY or X_BEARER_TOKEN: scans read the free public calendars and RSS feeds only, so they find fewer events"
  };
}

export function evaluateDatabase(input: { configured: boolean; mockMode: boolean; localDataPath?: string }): CheckResult {
  if (input.mockMode) {
    return { status: "ok", label: "Storage", detail: "mock mode keeps sample data in memory; nothing is written" };
  }
  if (input.configured) {
    return { status: "ok", label: "Storage", detail: "Postgres (DATABASE_URL)" };
  }
  return {
    status: "ok",
    label: "Storage",
    detail: `local file ${input.localDataPath ?? ".scout-data/store.json"} (set DATABASE_URL to use Postgres)`
  };
}

export function evaluateTelegram(botConfigured: boolean, chatConfigured: boolean): CheckResult {
  if (botConfigured && chatConfigured) {
    return { status: "ok", label: "Telegram", detail: "digest will be sent to Telegram" };
  }
  if (botConfigured || chatConfigured) {
    return {
      status: "warn",
      label: "Telegram",
      detail:
        "only one of TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID is set; both are required, so the digest will print to the console instead"
    };
  }
  return { status: "skip", label: "Telegram", detail: "not configured; the digest will print to the console" };
}

/**
 * Exit-non-zero policy: only conditions that keep the app from starting at all (Node too old,
 * dependencies missing, a profile/env that fails to load) or that leave real mode unable to do
 * anything the mock pipeline cannot already do (no LLM, or no discovery connector) are "fail".
 * Everything else (Firecrawl, Postgres, Telegram, an out-of-repo `.env.local`) degrades
 * gracefully, so it is at most a "warn".
 */
export function buildDoctorChecks(input: DoctorInput): CheckResult[] {
  return [
    evaluateNodeVersion(input.nodeVersion, input.minNodeMajor),
    evaluateDependenciesInstalled(input.dependenciesInstalled),
    evaluateEnvFileSource({ envFilePath: input.envFilePath, repoRoot: input.repoRoot, homeDir: input.homeDir }),
    evaluateMode(input.mockMode),
    evaluateProfile(input),
    evaluateLlm(input.llm, input.mockMode),
    evaluateConnector({
      name: "Exa (web search)",
      configured: input.exaConfigured,
      recommended: true,
      configuredDetail: "web search enabled for discovery",
      missingDetail: "no EXA_API_KEY: web search disabled; only public calendars, RSS, and X (if configured) will find events"
    }),
    evaluateConnector({
      name: "X / Twitter",
      configured: input.xConfigured,
      recommended: false,
      configuredDetail: "X discovery enabled",
      missingDetail: "no X_BEARER_TOKEN: events shared only on X may be missed (X API reads are paid; see docs/setup-and-costs.md)"
    }),
    evaluateConnector({
      name: "Firecrawl",
      configured: input.firecrawlConfigured,
      recommended: false,
      configuredDetail: "using Firecrawl for page fetching",
      missingDetail: "no FIRECRAWL_API_KEY: falling back to plain fetch (fine for most pages)"
    }),
    evaluateDiscoveryRequirement({
      exaConfigured: input.exaConfigured,
      xConfigured: input.xConfigured,
      mockMode: input.mockMode
    }),
    evaluateDatabase({ configured: input.databaseConfigured, mockMode: input.mockMode, localDataPath: input.localDataPath }),
    evaluateTelegram(input.telegramBotConfigured, input.telegramChatConfigured),
    ...(input.budgets ? [evaluateBudget(input.budgets, input.mockMode)] : [])
  ];
}

export function hasFailures(checks: readonly CheckResult[]): boolean {
  return checks.some((check) => check.status === "fail");
}

const STATUS_SYMBOLS: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗", skip: "–" };

export function formatCheckLine(check: CheckResult): string {
  const symbol = STATUS_SYMBOLS[check.status];
  return check.detail ? `${symbol} ${check.label}: ${check.detail}` : `${symbol} ${check.label}`;
}

export function formatDoctorReport(checks: readonly CheckResult[]): string {
  return checks.map(formatCheckLine).join("\n");
}

/**
 * The subset of `AppEnv` (packages/shared/src/index.ts) that `buildDoctorJsonSummary` needs.
 * Duck-typed instead of importing `AppEnv` itself: index.ts re-exports this whole module
 * (`export * from "./doctor.js"`), so importing it back here would be circular.
 */
export interface DoctorJsonEnv {
  mockMode: boolean;
  profile: ScoutProfile;
  profileSource: string;
  llm: LlmConfig;
  exaApiKey?: string;
  xBearerToken?: string;
  firecrawlApiKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  databaseUrl?: string;
}

export interface DoctorJsonSummary {
  /** True exactly when none of `checks`/`liveChecks` failed -- what `pnpm config:check`'s exit code is based on. */
  ok: boolean;
  checks: CheckResult[];
  liveChecks?: CheckResult[];
  mode: string;
  profile: {
    name: string;
    loadedFrom: string;
    persona: string;
    region: string;
    boosts: string[];
    penalties: string[];
    excluded: string[];
    searchPhrases: string[];
    extraSources: string[];
    disabledSources: string[];
    thresholds: { recommend: number; review: number };
  };
  llm: Record<string, unknown>;
  connectors: {
    exa: boolean;
    x: boolean;
    firecrawl: boolean;
    telegram: boolean;
    database: boolean;
  };
}

/**
 * Builds the exact JSON payload `pnpm config:check` (`pnpm scout:doctor --json`) prints: the same
 * `ok`/`checks` the checklist bases its exit code on, plus the human-readable profile/LLM/connector
 * summary the JSON output has always had. Pure and side-effect-free, so the "ok"/exit-code logic
 * (previously only exercised by actually running the script) is unit-testable on its own.
 */
export function buildDoctorJsonSummary(env: DoctorJsonEnv, checks: CheckResult[], liveChecks?: CheckResult[]): DoctorJsonSummary {
  const { profile } = env;
  return {
    ok: !hasFailures(liveChecks ? [...checks, ...liveChecks] : checks),
    checks,
    ...(liveChecks ? { liveChecks } : {}),
    mode: env.mockMode ? "mock (MOCK_MODE is not false)" : "real",
    profile: {
      name: profile.name,
      loadedFrom: env.profileSource,
      persona: profile.persona,
      region: `${profile.region.name}: ${profile.region.cities.join(", ")}`,
      boosts: positiveTopics(profile).map((topic) => `${topic.name} (+${topic.weight})`),
      penalties: negativeTopics(profile).map((topic) => `${topic.name} (${topic.weight})`),
      excluded: [...profile.exclude.formats, ...profile.exclude.topics, ...profile.exclude.eligibility],
      searchPhrases: profile.search.phrases,
      extraSources: profile.sources.add.map((source) => source.name),
      disabledSources: profile.sources.disable,
      thresholds: profile.thresholds
    },
    llm: describeLlm(env.llm),
    connectors: {
      exa: Boolean(env.exaApiKey),
      x: Boolean(env.xBearerToken),
      firecrawl: Boolean(env.firecrawlApiKey),
      telegram: Boolean(env.telegramBotToken && env.telegramChatId),
      database: Boolean(env.databaseUrl)
    }
  };
}
