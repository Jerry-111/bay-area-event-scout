#!/usr/bin/env node
/**
 * One command for running the scout on your own computer. Only Node.js is required.
 *
 *   npm start               # installs, asks setup questions the first time, scans, opens the dashboard
 *   npm start scan          # scan for new events, then open the dashboard
 *   npm start dashboard     # just open the dashboard
 *   npm start setup         # keys, Telegram, budget, and preferences (the `pnpm onboard` wizard)
 *   npm start preferences   # show or change your preferences with a sentence
 *   npm start undo          # undo the last preferences change
 *   npm start doctor        # check the setup
 *   npm start -- --check    # smoke test for CI: install, sample scan, dashboard health check, exit
 *
 * `pnpm start` works the same way. This file has no dependencies: it runs before anything is
 * installed, finds pnpm on its own (a global pnpm, else Corepack, else npx), and runs the built
 * worker, dashboard, and setup scripts directly with Node, so nothing else has to be on the PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createInterface as createPromptInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IS_WINDOWS = process.platform === "win32";
const MIN_NODE_MAJOR = 22;
const DASHBOARD_PORT = 4310;
const STALE_SCAN_HOURS = 6;
const INTERACTIVE = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
const action = argv.find((arg) => !arg.startsWith("--"));
const ACTIONS = ["scan", "dashboard", "setup", "preferences", "undo", "doctor"];

// Children see a clean environment: no npm_* variables from `npm start` (pnpm would read some of
// them as its own settings), and SCOUT_LAUNCHER so the setup scripts suggest `npm start ...`
// commands instead of `pnpm ...` ones, which need pnpm on the PATH.
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)));
baseEnv.SCOUT_LAUNCHER = "npm-start";

async function main() {
  checkNodeVersion();
  if (action && !ACTIONS.includes(action)) {
    throw new Error(`Unknown command "${action}". Try one of: ${ACTIONS.join(", ")} (or just npm start).`);
  }

  console.log("Bay Area Event Scout\n");
  await installIfNeeded();

  if (flags.has("--check")) return smokeTest();

  const firstRun = !existsSync(join(ROOT, ".env.local"));
  if (firstRun && INTERACTIVE && !action) {
    console.log("Welcome! A few setup questions first (about 5 minutes).");
    console.log("Press Enter to skip anything you don't have yet. With no LLM key you'll see sample data,");
    console.log("and you can finish setup later with: npm start setup\n");
    runScript("onboard.ts");
  }

  const settings = await loadSettings();
  if (firstRun && INTERACTIVE && !action) console.log();
  const chosen = action ?? (INTERACTIVE ? await chooseAction(settings) : "dashboard");

  switch (chosen) {
    case "setup":
      return runScriptOrExit("onboard.ts");
    case "doctor":
      return runScriptOrExit("doctor.ts");
    case "preferences":
      return runScriptOrExit("profile-edit.ts");
    case "undo":
      return runScriptOrExit("profile-edit.ts", ["--undo"]);
    case "scan":
      if (!settings.env?.llm.enabled) {
        console.log("Scanning real events needs an LLM key, and none is set up yet. Run: npm start setup");
        return openDashboard();
      }
      await scan({ sampleData: false });
      return openDashboard();
    default:
      return openDashboard();
  }
}

// ---------------------------------------------------------------------------
// Install and build
// ---------------------------------------------------------------------------

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= MIN_NODE_MAJOR) return;
  throw new Error(
    `This needs Node.js ${MIN_NODE_MAJOR} or newer, and this computer has ${process.version}.\n` +
      "Download the LTS installer from https://nodejs.org/en/download, run it, then run npm start again."
  );
}

async function installIfNeeded() {
  const marker = join(ROOT, "node_modules", ".modules.yaml");
  const installedAt = existsSync(marker) ? statSync(marker).mtimeMs : 0;
  const outdated = ["package.json", "pnpm-lock.yaml"].some((file) => statSync(join(ROOT, file)).mtimeMs > installedAt);
  if (!outdated) {
    build();
    return;
  }

  const pnpm = findPnpm();
  console.log("Installing (the first time takes a minute or two)...");
  // pnpm's own output is a wall of progress lines; it is only shown if something goes wrong.
  const started = Date.now();
  const ticker = INTERACTIVE
    ? setInterval(() => process.stdout.write(`\r\x1b[2K  ... ${Math.round((Date.now() - started) / 1000)}s`), 1000)
    : undefined;
  const result = await runCollectingOutput(pnpm.command, [...pnpm.prefix, "install", "--frozen-lockfile", "--reporter=append-only"], {
    cwd: ROOT,
    shell: IS_WINDOWS,
    env: { ...baseEnv, ...pnpm.env }
  });
  if (ticker) {
    clearInterval(ticker);
    process.stdout.write("\r\x1b[2K");
  }
  if (result.code !== 0) {
    console.log(result.output);
    throw new Error("Installing failed; the messages above say why. Check your internet connection and run npm start again.");
  }
  console.log("  ✓ Installed\n");
}

function runCollectingOutput(command, args, options) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolveRun({ code: 1, output: `${output}${error.message}` }));
    child.on("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

/** Brings the compiled code up to date (fast when nothing changed, e.g. after `git pull`). */
function build() {
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [tsc, "-b"], { cwd: ROOT, encoding: "utf8", env: baseEnv });
  if (result.status !== 0) {
    throw new Error(`Building the project failed:\n${result.stdout}${result.stderr}`);
  }
}

/** A global pnpm (9+, which follows package.json's pinned version), else Corepack, else npx. */
function findPnpm() {
  const pinned = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).packageManager ?? "pnpm@11";
  const candidates = [
    { command: "pnpm", prefix: [], env: {}, accept: (version) => Number(version.split(".")[0]) >= 9 },
    { command: "corepack", prefix: ["pnpm"], env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" } },
    { command: "npx", prefix: ["--yes", pinned], env: {} }
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, "--version"], {
      cwd: ROOT,
      encoding: "utf8",
      shell: IS_WINDOWS,
      env: { ...baseEnv, ...candidate.env }
    });
    const version = probe.stdout?.trim() ?? "";
    if (probe.status === 0 && (!candidate.accept || candidate.accept(version))) return candidate;
  }
  throw new Error("Could not find or download pnpm. Check your internet connection, or install it with: npm install -g pnpm");
}

// ---------------------------------------------------------------------------
// Settings and the menu
// ---------------------------------------------------------------------------

async function loadSettings() {
  const shared = await import(pathToFileURL(join(ROOT, "packages", "shared", "dist", "index.js")).href);
  try {
    const env = shared.loadRuntimeEnv(ROOT, baseEnv);
    return { env, lastScan: lastScanTime(env) };
  } catch (error) {
    console.log(`Your settings have a problem: ${error instanceof Error ? error.message : String(error)}`);
    console.log("Fix it with: npm start setup   (or check everything with: npm start doctor)\n");
    return { env: undefined, lastScan: undefined };
  }
}

/** When the newest real scan in the local results file started; null if there is none yet. */
function lastScanTime(env) {
  if (env.databaseUrl) return undefined;
  const file = join(resolve(ROOT, env.scoutDataDir || ".scout-data"), "store.json");
  if (!existsSync(file)) return null;
  try {
    const runs = JSON.parse(readFileSync(file, "utf8")).runs ?? [];
    const times = runs.map((run) => Date.parse(run.startedAt)).filter(Number.isFinite);
    return times.length ? new Date(Math.max(...times)) : null;
  } catch {
    return undefined;
  }
}

async function chooseAction(settings) {
  const canScan = Boolean(settings.env?.llm.enabled);
  const hasDatabase = Boolean(settings.env?.databaseUrl);
  const options = canScan
    ? [
        { action: "scan", label: `Scan for new events, then open the dashboard (${describeLastScan(settings.lastScan)})` },
        { action: "dashboard", label: "Open the dashboard" },
        { action: "preferences", label: "Show or change my preferences" },
        { action: "setup", label: "Change keys, Telegram, budget, or preferences (setup)" },
        { action: "doctor", label: "Check my setup" }
      ]
    : [
        { action: "dashboard", label: hasDatabase ? "Open the dashboard (results from your database)" : "Open the dashboard with sample data" },
        { action: "setup", label: "Set up an LLM key (and more) to scan from this computer" },
        { action: "doctor", label: "Check my setup" }
      ];
  const scanIsStale =
    settings.lastScan === null || (settings.lastScan instanceof Date && Date.now() - settings.lastScan.getTime() > STALE_SCAN_HOURS * 3_600_000);
  const defaultIndex = canScan && !scanIsStale ? 2 : 1;

  if (!canScan && !hasDatabase) console.log("No LLM key is set up yet, so the dashboard shows sample data.\n");
  console.log("What would you like to do?");
  options.forEach((option, index) => console.log(`  ${index + 1}) ${option.label}`));
  const rl = createPromptInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Enter a number [${defaultIndex}]: `)).trim();
    const picked = options[(answer ? Number(answer) : defaultIndex) - 1];
    console.log();
    return picked?.action ?? options[defaultIndex - 1].action;
  } finally {
    rl.close();
  }
}

function describeLastScan(lastScan) {
  if (lastScan === null) return "no scans yet";
  if (!(lastScan instanceof Date)) return "about 3-10 minutes";
  const hours = (Date.now() - lastScan.getTime()) / 3_600_000;
  if (hours < 1) return "last scan: less than an hour ago";
  if (hours < 48) return `last scan: ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  return `last scan: ${Math.round(hours / 24)} days ago`;
}

// ---------------------------------------------------------------------------
// Scanning, with a short progress display instead of the worker's full logs
// ---------------------------------------------------------------------------

async function scan({ sampleData }) {
  console.log(sampleData ? "Running a sample scan..." : "Scanning for events. This usually takes 3-10 minutes; you can leave it running.\n");
  const child = spawn(process.execPath, [join(ROOT, "apps", "worker", "dist", "jobs", "run-scout.js")], {
    cwd: ROOT,
    env: { ...baseEnv, MOCK_MODE: sampleData ? "true" : "false", LOG_FORMAT: "json", LOG_LEVEL: "debug" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const progress = new ScanProgress();
  createInterface({ input: child.stdout }).on("line", (line) => progress.handle(line, false));
  createInterface({ input: child.stderr }).on("line", (line) => progress.handle(line, true));
  const code = await new Promise((resolveExit) => child.on("close", resolveExit));
  progress.finish(code === 0);
  return code === 0;
}

const SKIPPED_SOURCE_NOTES = [
  [/EXA_API_KEY missing/, "No Exa key, so skipping web search (the public calendars are still read)"],
  [/X_BEARER_TOKEN missing/, "No X key, so skipping X"]
];

class ScanProgress {
  constructor() {
    this.extractTotal = 0;
    this.extracted = 0;
    this.scoreTotal = 0;
    this.scored = 0;
    this.live = "";
    this.problems = new Map();
    this.result = {};
  }

  handle(line, fromStderr) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // The worker ends with its run stats as indented JSON on stdout; anything else unparsed on
      // stderr is an error worth showing as-is.
      if (fromStderr && line.trim()) this.note(line.trim());
      return;
    }
    if (!entry || typeof entry !== "object" || typeof entry.message !== "string") return;

    if (entry.level === "warn" || entry.level === "error") {
      const detail = entry.error ?? entry.reason ?? "";
      const key = `${entry.message}${detail ? `: ${String(detail).slice(0, 160)}` : ""}`;
      this.problems.set(key, (this.problems.get(key) ?? 0) + 1);
    }

    switch (entry.message) {
      case "search planner started":
        this.setLive("Planning searches...");
        break;
      case "discovery started":
        this.setLive("Searching calendars, newsletters, the web, and X...");
        break;
      case "discovery finished":
        this.done(`Found ${entry.candidatesFound ?? 0} links that might be events`);
        break;
      case "candidate extraction cap applied":
        this.extractTotal = Math.min(entry.candidatesReceived ?? 0, entry.effectiveExtractLimit ?? 0);
        this.setLive(`Reading event pages: 0/${this.extractTotal}`);
        break;
      case "candidate extraction finished":
      case "candidate extraction failed":
        this.extracted += 1;
        this.setLive(`Reading event pages: ${this.extracted}/${this.extractTotal || "?"}`);
        break;
      case "candidate extraction aggregation finished":
        this.done(`Read ${this.extracted} pages and found ${entry.deduped ?? entry.rawExtracted ?? 0} distinct events`);
        break;
      case "event scoring cap applied":
        this.scoreTotal = entry.effectiveScoreLimit ?? 0;
        this.setLive(`Scoring events: 0/${this.scoreTotal}`);
        break;
      case "event scoring finished":
      case "event scoring failed":
        this.scored += 1;
        this.setLive(`Scoring events: ${this.scored}/${this.scoreTotal || "?"}`);
        break;
      case "extraction and scoring finished":
        if (this.scored) this.done(`Scored ${this.scored} events against your preferences`);
        break;
      case "digest finished":
        this.result.delivered = entry.delivered === true;
        break;
      case "pipeline quality summary":
        this.result.recommended = entry.recommendationsCreated;
        break;
      default:
        break;
    }
  }

  setLive(text) {
    this.live = text;
    if (INTERACTIVE) process.stdout.write(`\r\x1b[2K  ... ${text}`);
  }

  done(text) {
    if (INTERACTIVE) process.stdout.write("\r\x1b[2K");
    this.live = "";
    console.log(`  ✓ ${text}`);
  }

  note(text) {
    if (INTERACTIVE && this.live) process.stdout.write("\r\x1b[2K");
    // Optional sources that are simply not set up are expected, not warnings.
    const skipped = SKIPPED_SOURCE_NOTES.find(([pattern]) => pattern.test(text));
    console.log(skipped ? `  – ${skipped[1]}` : `  ! ${text}`);
    if (INTERACTIVE && this.live) process.stdout.write(`  ... ${this.live}`);
  }

  finish(ok) {
    if (INTERACTIVE && this.live) process.stdout.write("\r\x1b[2K");
    if (ok) {
      const recommended = this.result.recommended ?? 0;
      const where = this.result.delivered ? " and sent to Telegram" : "";
      console.log(`  ✓ Done: ${recommended} new recommendation${recommended === 1 ? "" : "s"}${where}.`);
    } else {
      console.log("  ✗ The scan stopped with an error.");
    }
    const problems = [...this.problems.entries()].slice(0, 5);
    if (problems.length) {
      console.log(ok ? "\n  Worth knowing:" : "\n  What went wrong:");
      for (const [problem, count] of problems) console.log(`    - ${problem}${count > 1 ? ` (x${count})` : ""}`);
    }
    if (!ok) console.log("\n  Check your keys and settings with: npm start doctor");
    console.log();
  }
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

async function openDashboard({ holdOpen = true } = {}) {
  const running = await dashboardAt(DASHBOARD_PORT);
  if (running) {
    const url = `http://127.0.0.1:${DASHBOARD_PORT}`;
    openBrowser(url);
    console.log(`The dashboard is already running at ${url} (opened in your browser).`);
    return;
  }

  const port = await firstFreePort(DASHBOARD_PORT);
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(ROOT, "apps", "admin", "dist", "index.js")], {
    cwd: ROOT,
    env: { ...baseEnv, ADMIN_PORT: String(port), LOG_LEVEL: baseEnv.LOG_LEVEL ?? "warn" },
    stdio: "inherit"
  });
  const exited = new Promise((resolveExit) => child.on("close", resolveExit));

  if (!(await waitForDashboard(port, 30_000))) {
    child.kill();
    throw new Error("The dashboard did not start. Run `npm start doctor` to check your setup.");
  }
  if (!holdOpen) {
    child.kill();
    await exited;
    return url;
  }

  if (!flags.has("--no-open")) openBrowser(url);
  console.log(`Dashboard: ${url}${flags.has("--no-open") ? "" : " (opened in your browser)"}`);
  console.log("Keep this window open while you use it; press Ctrl+C to stop.");
  console.log("Next time, run npm start again to scan for new events.");
  const stop = () => child.kill("SIGINT");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await exited;
  return url;
}

async function dashboardAt(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json();
    return body?.ok === true && typeof body.mode === "string";
  } catch {
    return false;
  }
}

async function waitForDashboard(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await dashboardAt(port)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  return false;
}

async function firstFreePort(start) {
  for (let port = start; port < start + 20; port += 1) {
    const free = await new Promise((resolveFree) => {
      const server = createServer()
        .once("error", () => resolveFree(false))
        .once("listening", () => server.close(() => resolveFree(true)))
        .listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error(`No free port between ${start} and ${start + 19} for the dashboard.`);
}

function openBrowser(url) {
  if (flags.has("--no-open")) return;
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : IS_WINDOWS ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // No browser to open (a server, a container): the URL is printed anyway.
  }
}

// ---------------------------------------------------------------------------
// Setup scripts and the CI smoke test
// ---------------------------------------------------------------------------

function runScript(file, args = []) {
  const tsx = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(process.execPath, [tsx, join(ROOT, "scripts", file), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: baseEnv
  });
  return result.status ?? 1;
}

function runScriptOrExit(file, args = []) {
  process.exitCode = runScript(file, args);
}

async function smokeTest() {
  const ok = await scan({ sampleData: true });
  if (!ok) throw new Error("The sample scan failed.");
  const url = await openDashboard({ holdOpen: false });
  console.log(`Smoke test passed: sample scan finished and the dashboard answered at ${url}.`);
}

// Last, so every class and function above is defined before anything runs.
main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
