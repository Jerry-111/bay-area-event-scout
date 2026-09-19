import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDoctorChecks,
  buildDoctorJsonSummary,
  displayPath,
  evaluateConnector,
  evaluateDatabase,
  evaluateDependenciesInstalled,
  evaluateDiscoveryRequirement,
  evaluateEnvFileSource,
  evaluateLlm,
  evaluateMode,
  evaluateNodeVersion,
  evaluateProfile,
  evaluateTelegram,
  formatCheckLine,
  hasFailures,
  type CheckResult,
  type DoctorInput,
  type DoctorJsonEnv
} from "./doctor.js";
import { resolveLlmConfig } from "./llm-config.js";
import { DEFAULT_PROFILE } from "./profile.js";

test("evaluateNodeVersion accepts current majors and rejects old ones", () => {
  assert.equal(evaluateNodeVersion("v22.21.1").status, "ok");
  assert.equal(evaluateNodeVersion("v24.0.0").status, "ok");
  const old = evaluateNodeVersion("v18.19.0");
  assert.equal(old.status, "fail");
  assert.match(old.detail ?? "", /Node.js 22 or newer/);
  assert.equal(evaluateNodeVersion("v20.10.0", 20).status, "ok");
});

test("evaluateDependenciesInstalled reflects whether node_modules is present", () => {
  assert.equal(evaluateDependenciesInstalled(true).status, "ok");
  assert.equal(evaluateDependenciesInstalled(false).status, "fail");
});

test("evaluateEnvFileSource warns loudly only when the file is outside the repo root", () => {
  assert.equal(evaluateEnvFileSource({}).status, "ok");
  assert.equal(evaluateEnvFileSource({ envFilePath: "/repo/.env.local", repoRoot: "/repo" }).status, "ok");

  const outside = evaluateEnvFileSource({ envFilePath: "/parent/.env.local", repoRoot: "/parent/repo" });
  assert.equal(outside.status, "warn");
  assert.match(outside.detail ?? "", /OUTSIDE this repo/);
});

test("evaluateMode is informational either way", () => {
  assert.equal(evaluateMode(true).status, "ok");
  assert.equal(evaluateMode(false).status, "ok");
  assert.match(evaluateMode(true).detail ?? "", /mock/);
  assert.match(evaluateMode(false).detail ?? "", /real/);
});

test("evaluateProfile fails loudly on a load error, otherwise reports name and source", () => {
  assert.equal(evaluateProfile({ profileError: "bad yaml" }).status, "fail");
  const ok = evaluateProfile({ profileName: "fintech", profileSource: "profiles/fintech.yaml" });
  assert.equal(ok.status, "ok");
  assert.match(ok.detail ?? "", /fintech \(from profiles\/fintech\.yaml\)/);
});

test("evaluateLlm only fails when a real run has no provider configured", () => {
  const disabled = resolveLlmConfig({});
  assert.equal(evaluateLlm(disabled, true).status, "skip");
  assert.equal(evaluateLlm(disabled, false).status, "fail");

  const enabled = resolveLlmConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "sk-test" });
  assert.equal(evaluateLlm(enabled, false).status, "ok");
  assert.match(evaluateLlm(enabled, false).detail ?? "", /openai/);
});

test("evaluateConnector treats a missing recommended connector as a warning, optional ones as ok", () => {
  const missingRecommended = evaluateConnector({
    name: "Exa",
    configured: false,
    recommended: true,
    configuredDetail: "on",
    missingDetail: "off"
  });
  assert.equal(missingRecommended.status, "warn");

  const missingOptional = evaluateConnector({
    name: "Firecrawl",
    configured: false,
    recommended: false,
    configuredDetail: "on",
    missingDetail: "off"
  });
  assert.equal(missingOptional.status, "skip");

  const configured = evaluateConnector({
    name: "Exa",
    configured: true,
    recommended: true,
    configuredDetail: "on",
    missingDetail: "off"
  });
  assert.equal(configured.status, "ok");
  assert.equal(configured.detail, "on");
});

test("evaluateDiscoveryRequirement only warns for real mode with no discovery connector (public sources still work)", () => {
  assert.equal(evaluateDiscoveryRequirement({ exaConfigured: false, xConfigured: false, mockMode: true }).status, "skip");
  assert.equal(evaluateDiscoveryRequirement({ exaConfigured: false, xConfigured: false, mockMode: false }).status, "warn");
  assert.equal(evaluateDiscoveryRequirement({ exaConfigured: true, xConfigured: false, mockMode: false }).status, "ok");
  assert.equal(evaluateDiscoveryRequirement({ exaConfigured: false, xConfigured: true, mockMode: false }).status, "ok");
});

test("evaluateDatabase and evaluateTelegram are informational, but a half-configured Telegram warns", () => {
  assert.match(evaluateDatabase({ configured: false, mockMode: true }).detail ?? "", /in memory/);
  assert.match(evaluateDatabase({ configured: true, mockMode: false }).detail ?? "", /Postgres/);
  const local = evaluateDatabase({ configured: false, mockMode: false, localDataPath: ".scout-data/store.json" });
  assert.equal(local.status, "ok");
  assert.match(local.detail ?? "", /\.scout-data\/store\.json/);
  assert.equal(evaluateTelegram(true, true).status, "ok");
  assert.equal(evaluateTelegram(false, false).status, "skip");
  assert.equal(evaluateTelegram(true, false).status, "warn");
  assert.equal(evaluateTelegram(false, true).status, "warn");
});

function baseInput(overrides: Partial<DoctorInput> = {}): DoctorInput {
  return {
    nodeVersion: "v22.21.1",
    dependenciesInstalled: true,
    mockMode: true,
    profileName: "consumer-ai-founder",
    profileSource: "built-in default (consumer-ai-founder)",
    llm: resolveLlmConfig({}),
    exaConfigured: false,
    xConfigured: false,
    firecrawlConfigured: false,
    databaseConfigured: false,
    telegramBotConfigured: false,
    telegramChatConfigured: false,
    ...overrides
  };
}

test("buildDoctorChecks: a fresh clone in mock mode with nothing configured passes clean", () => {
  const checks = buildDoctorChecks(baseInput());
  assert.equal(hasFailures(checks), false);
  assert.ok(checks.some((check) => check.label === "Mode"));
});

test("buildDoctorChecks: real mode with no LLM fails; no discovery key only warns", () => {
  const checks = buildDoctorChecks(baseInput({ mockMode: false }));
  assert.equal(hasFailures(checks), true);
  const failing = checks.filter((check) => check.status === "fail").map((check) => check.label);
  assert.deepEqual(failing, ["LLM"]);
  const warning = checks.filter((check) => check.status === "warn").map((check) => check.label);
  assert.ok(warning.includes("Discovery (real mode)"));
});

test("buildDoctorChecks: real mode with an LLM and Exa configured passes", () => {
  const checks = buildDoctorChecks(
    baseInput({
      mockMode: false,
      llm: resolveLlmConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "sk-test" }),
      exaConfigured: true
    })
  );
  assert.equal(hasFailures(checks), false);
});

test("buildDoctorChecks: an invalid profile is always a hard failure, mock mode or not", () => {
  const checks = buildDoctorChecks(baseInput({ profileError: "Invalid scout profile: bad yaml" }));
  assert.equal(hasFailures(checks), true);
});

test("displayPath keeps the home directory out of pasted output", () => {
  assert.equal(displayPath("/home/me/repo/.env.local", "/home/me/repo", "/home/me"), ".env.local");
  assert.equal(displayPath("/home/me/.env.local", "/home/me/repo", "/home/me"), "~/.env.local");
  assert.equal(displayPath("/etc/scout/.env.local", "/home/me/repo", "/home/me"), "/etc/scout/.env.local");
  const outside = evaluateEnvFileSource({ envFilePath: "/home/me/.env.local", repoRoot: "/home/me/repo", homeDir: "/home/me" });
  assert.doesNotMatch(outside.detail ?? "", /\/home\/me/);
});

test("evaluateEnvFileSource tells a stray file inside the repo apart from one outside it", () => {
  const inside = evaluateEnvFileSource({ envFilePath: "/repo/apps/worker/.env.local", repoRoot: "/repo" });
  assert.equal(inside.status, "warn");
  assert.match(inside.detail ?? "", /not the repo root/);
  assert.doesNotMatch(inside.detail ?? "", /OUTSIDE/);
  assert.match(evaluateEnvFileSource({ envFilePath: "/elsewhere/.env.local", repoRoot: "/repo" }).detail ?? "", /OUTSIDE/);
});

test("evaluateProfile explains how to change the built-in default", () => {
  assert.match(
    evaluateProfile({ profileName: "consumer-ai-founder", profileSource: "built-in default (consumer-ai-founder)" }).detail ?? "",
    /built-in default; set SCOUT_PROFILE/
  );
});

test("formatCheckLine renders the status symbol, label, and detail", () => {
  assert.equal(formatCheckLine({ status: "ok", label: "Mode", detail: "mock" }), "✓ Mode: mock");
  assert.equal(formatCheckLine({ status: "warn", label: "Telegram" }), "! Telegram");
  assert.equal(formatCheckLine({ status: "fail", label: "Profile", detail: "broken" }), "✗ Profile: broken");
  assert.equal(formatCheckLine({ status: "skip", label: "Telegram", detail: "not configured" }), "– Telegram: not configured");
});

function baseJsonEnv(overrides: Partial<DoctorJsonEnv> = {}): DoctorJsonEnv {
  return {
    mockMode: true,
    profile: DEFAULT_PROFILE,
    profileSource: "built-in default (consumer-ai-founder)",
    llm: resolveLlmConfig({}),
    ...overrides
  };
}

test("buildDoctorJsonSummary: ok is true when nothing failed, false otherwise (this is config:check's exit-code logic)", () => {
  const passing: CheckResult[] = [{ status: "ok", label: "Mode", detail: "mock" }, { status: "warn", label: "Telegram" }];
  assert.equal(buildDoctorJsonSummary(baseJsonEnv(), passing).ok, true);

  const failing: CheckResult[] = [{ status: "ok", label: "Mode" }, { status: "fail", label: "LLM", detail: "disabled" }];
  assert.equal(buildDoctorJsonSummary(baseJsonEnv(), failing).ok, false);
});

test("buildDoctorJsonSummary folds a failing live check into ok, but only when liveChecks is passed", () => {
  const checks: CheckResult[] = [{ status: "ok", label: "Mode" }];
  const failingLive: CheckResult[] = [{ status: "fail", label: "Live: LLM", detail: "timed out" }];

  assert.equal(buildDoctorJsonSummary(baseJsonEnv(), checks, failingLive).ok, false);
  assert.equal(buildDoctorJsonSummary(baseJsonEnv(), checks).ok, true); // no --live: live failures aren't in scope
});

test("buildDoctorJsonSummary embeds the checks (and liveChecks, only when given) verbatim for the caller to serialize", () => {
  const checks: CheckResult[] = [{ status: "ok", label: "Mode", detail: "mock" }];
  const withoutLive = buildDoctorJsonSummary(baseJsonEnv(), checks);
  assert.deepEqual(withoutLive.checks, checks);
  assert.equal("liveChecks" in withoutLive, false);

  const liveChecks: CheckResult[] = [{ status: "ok", label: "Live: LLM", detail: "skipped" }];
  const withLive = buildDoctorJsonSummary(baseJsonEnv(), checks, liveChecks);
  assert.deepEqual(withLive.liveChecks, liveChecks);
});

test("buildDoctorJsonSummary reports the same profile/llm/connector data the JSON output has always had", () => {
  const summary = buildDoctorJsonSummary(
    baseJsonEnv({ llm: resolveLlmConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "sk-test" }), exaApiKey: "key" }),
    []
  );
  assert.equal(summary.mode, "mock (MOCK_MODE is not false)");
  assert.equal(summary.profile.name, DEFAULT_PROFILE.name);
  assert.deepEqual(summary.profile.thresholds, DEFAULT_PROFILE.thresholds);
  assert.equal(summary.llm.provider, "openai");
  assert.equal(summary.connectors.exa, true);
  assert.equal(summary.connectors.database, false);
});
