/**
 * Friendly, network-free-by-default configuration checklist.
 *
 * IMPORTANT: bare `pnpm doctor` is intercepted by pnpm 11's own built-in `doctor` diagnostic
 * command (it checks pnpm's install health, not this project) and never reaches this script.
 * Invoke this one as `pnpm scout:doctor` (or `pnpm run doctor`; `pnpm config:check` prints JSON).
 *
 *   pnpm run doctor          # checklist (exits non-zero if real mode is missing something it needs)
 *   pnpm scout:doctor        # same thing; a bare command that does not collide with pnpm's own "doctor"
 *   pnpm config:check        # same script with --json (the old scripts/check-config.ts output)
 *   pnpm run doctor --live   # also runs cheap live checks: a tiny LLM request, a 1-result Exa
 *                            # search, Telegram getMe, and `select 1` against DATABASE_URL --
 *                            # each only for a connector that is actually configured.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import {
  booleanFlag,
  buildDoctorChecks,
  buildDoctorJsonSummary,
  commandHint,
  fetchWithTimeout,
  findRepoRoot,
  findUpPath,
  formatCheckLine,
  hasFailures,
  loadEnv,
  loadProfile,
  parseEnvFile,
  parseFlags,
  withTimeout,
  DEFAULT_PROFILE,
  type AppEnv,
  type CheckResult,
  type DoctorInput,
  type ScoutProfile
} from "../packages/shared/src/index.js";
import { resolveScoutDataDir, SCOUT_STORE_FILE_NAME } from "../packages/db/src/file-store.js";
import { pingDatabase } from "../packages/db/src/index.js";
import { callLlm } from "../packages/intelligence/src/llm-client.js";

const FLAG_SPEC = { json: "boolean", live: "boolean" } as const;

async function main(): Promise<void> {
  const { flags } = parseFlags(process.argv.slice(2), FLAG_SPEC);
  const wantsJson = booleanFlag(flags, "json");
  const wantsLive = booleanFlag(flags, "live");

  const cwd = process.cwd();
  const repoRoot = findRepoRoot(cwd);
  const envFilePath = findUpPath(cwd, ".env.local");
  const dependenciesInstalled = existsSync(join(repoRoot ?? cwd, "node_modules"));

  const { env, profileError } = loadDoctorEnv(cwd);

  const input: DoctorInput = {
    nodeVersion: process.version,
    dependenciesInstalled,
    envFilePath,
    repoRoot,
    homeDir: homedir(),
    mockMode: env.mockMode,
    profileError,
    profileName: profileError ? undefined : env.profile.name,
    profileSource: profileError ? undefined : env.profileSource,
    llm: env.llm,
    exaConfigured: Boolean(env.exaApiKey),
    xConfigured: Boolean(env.xBearerToken),
    firecrawlConfigured: Boolean(env.firecrawlApiKey),
    databaseConfigured: Boolean(env.databaseUrl),
    localDataPath: relative(repoRoot ?? cwd, join(resolveScoutDataDir(env.scoutDataDir, cwd), SCOUT_STORE_FILE_NAME)) || SCOUT_STORE_FILE_NAME,
    telegramBotConfigured: Boolean(env.telegramBotToken),
    telegramChatConfigured: Boolean(env.telegramChatId),
    budgets: env.budgets
  };

  // --json runs exactly the same checks as the checklist (including --live's live checks), so
  // scripts parsing `config:check` catch the same failures a human running `scout:doctor` would
  // see, instead of `config:check` only ever failing when the profile itself cannot load.
  const checks = buildDoctorChecks(input);
  const liveChecks = wantsLive ? await runLiveChecks(env) : [];
  const ok = !hasFailures([...checks, ...liveChecks]);

  if (wantsJson) {
    printJsonSummary(env, checks, wantsLive ? liveChecks : undefined);
  } else {
    printFriendlyReport(checks, liveChecks);
  }
  process.exitCode = ok ? 0 : 1;
}

/**
 * Loads the same way `loadRuntimeEnv` does, but keeps a broken profile from hiding the rest of
 * the checklist: a bad `SCOUT_PROFILE` or a YAML syntax error is reported as a failed "Profile"
 * check rather than crashing the whole command.
 */
function loadDoctorEnv(cwd: string): { env: AppEnv; profileError?: string } {
  const localPath = findUpPath(cwd, ".env.local");
  const localValues = localPath ? parseEnvFile(readFileSync(localPath, "utf8")) : {};
  const merged = { ...localValues, ...process.env };

  let profile: ScoutProfile | undefined;
  let profileSource: string | undefined;
  let profileError: string | undefined;
  try {
    const selection = loadProfile({ cwd, env: merged });
    profile = selection.profile;
    profileSource = selection.source;
  } catch (error) {
    profileError = error instanceof Error ? error.message : String(error);
  }

  try {
    return { env: loadEnv(merged, { profile, profileSource }), profileError };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // LLM_PROVIDER / LLM_EXTRA_BODY / a bad numeric budget var: loadEnv itself refused to build an
    // AppEnv. Fall back to defaults so the rest of the checklist can still run.
    const fallback = loadEnv({}, { profile: profile ?? DEFAULT_PROFILE, profileSource: profileSource ?? "unavailable" });
    return { env: fallback, profileError: profileError ?? message };
  }
}

function printJsonSummary(env: AppEnv, checks: CheckResult[], liveChecks?: CheckResult[]): void {
  const summary = buildDoctorJsonSummary(env, checks, liveChecks);
  console.log(JSON.stringify(summary, null, 2));
  if (!env.mockMode && !env.llm.enabled) {
    console.warn(`\nWarning: real mode without an LLM (${env.llm.disabledReason}). Scans collect candidate links but cannot read event pages.`);
  }
}

function printFriendlyReport(checks: CheckResult[], liveChecks: CheckResult[]): void {
  console.log("Bay Area Event Scout — configuration checklist\n");
  for (const check of checks) console.log(formatCheckLine(check));

  if (liveChecks.length) {
    console.log("\nLive checks (--live):");
    for (const check of liveChecks) console.log(formatCheckLine(check));
  }

  const all = [...checks, ...liveChecks];
  const failing = all.filter((check) => check.status === "fail").length;
  const warning = all.filter((check) => check.status === "warn").length;

  console.log();
  if (failing) {
    console.log(`${failing} check(s) failed, ${warning} warning(s). Run \`${commandHint("onboard")}\` to fix configuration, then re-run \`${commandHint("scout:doctor")}\`.`);
  } else if (warning) {
    console.log(`All required checks passed, ${warning} warning(s) worth a look.`);
  } else {
    console.log("All checks passed.");
  }
}

async function runLiveChecks(env: AppEnv): Promise<CheckResult[]> {
  return [await checkLlmLive(env), await checkExaLive(env), await checkTelegramLive(env), await checkPostgresLive(env)];
}

async function checkLlmLive(env: AppEnv): Promise<CheckResult> {
  if (!env.llm.enabled) {
    return { status: "skip", label: "Live: LLM", detail: "skipped — no LLM provider configured" };
  }
  try {
    const reply = await withTimeout(
      callLlm({ env, model: env.llm.models.fast, prompt: "Reply with only the single word OK." }),
      env.timeouts.llmMs + 2000,
      "Live LLM check"
    );
    return { status: "ok", label: "Live: LLM", detail: `${env.llm.provider} ${env.llm.models.fast} responded: ${reply.slice(0, 40)}` };
  } catch (error) {
    return { status: "fail", label: "Live: LLM", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkExaLive(env: AppEnv): Promise<CheckResult> {
  if (!env.exaApiKey) {
    return { status: "skip", label: "Live: Exa", detail: "skipped — no EXA_API_KEY" };
  }
  try {
    const response = await fetchWithTimeout(
      fetch,
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.exaApiKey },
        body: JSON.stringify({ query: "SF founder dinner", numResults: 1 })
      },
      env.timeouts.exaMs,
      "Live Exa check"
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { status: "fail", label: "Live: Exa", detail: `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { status: "ok", label: "Live: Exa", detail: "1-result search request succeeded" };
  } catch (error) {
    return { status: "fail", label: "Live: Exa", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkTelegramLive(env: AppEnv): Promise<CheckResult> {
  if (!env.telegramBotToken) {
    return { status: "skip", label: "Live: Telegram", detail: "skipped — no TELEGRAM_BOT_TOKEN" };
  }
  try {
    const response = await fetchWithTimeout(
      fetch,
      `https://api.telegram.org/bot${encodeURIComponent(env.telegramBotToken)}/getMe`,
      {},
      env.timeouts.telegramMs,
      "Live Telegram check"
    );
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string } };
    if (!response.ok || !payload.ok) {
      return { status: "fail", label: "Live: Telegram", detail: `getMe failed with HTTP ${response.status}` };
    }
    return { status: "ok", label: "Live: Telegram", detail: `bot @${payload.result?.username ?? "unknown"} reachable` };
  } catch (error) {
    return { status: "fail", label: "Live: Telegram", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkPostgresLive(env: AppEnv): Promise<CheckResult> {
  if (!env.databaseUrl) {
    return { status: "skip", label: "Live: Postgres", detail: "skipped — no DATABASE_URL" };
  }
  try {
    await withTimeout(pingDatabase(env), env.timeouts.postgresConnectionMs + env.timeouts.postgresQueryMs, "Live Postgres check");
    return { status: "ok", label: "Live: Postgres", detail: "`select 1` succeeded" };
  } catch (error) {
    return { status: "fail", label: "Live: Postgres", detail: error instanceof Error ? error.message : String(error) };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
