/**
 * Interactive setup wizard: gets a fresh clone from zero to a working `.env.local` (and
 * optionally a `scout.profile.yaml`) in a few minutes.
 *
 *   pnpm onboard
 *
 * Non-interactive mode, for scripting and tests (skips every prompt not covered by a flag):
 *
 *   pnpm onboard --yes [--provider <name>] [--api-key-env <VAR>] [--profile <preset|default>]
 *                      [--budget <small|medium|large>] [--verify] [--root <dir>]
 *
 *   --provider <name>      An LLM_PRESETS key (see packages/shared/src/llm-config.ts), or "none".
 *   --api-key-env <VAR>    Name of an already-exported env var to read the LLM API key from.
 *                          (Keeps the key out of shell history / process args.)
 *   --profile <preset>     A preset name from profiles/*.yaml, or "default" to keep the built-in
 *                          default. "describe yourself" needs the LLM and is interactive-only.
 *   --budget <name>        SCOUT_BUDGET: small, medium, or large (see docs/setup-and-costs.md).
 *   --verify               Also send one tiny request through the configured LLM to confirm the
 *                          key works. Off by default in non-interactive mode.
 *   --yes                  Run without any prompts; anything not covered by a flag is skipped.
 *   --root <dir>           Treat <dir> as the repo root instead of auto-detecting it (tests).
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  booleanFlag,
  commandHint,
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_NAME,
  describeProfile,
  findRepoRoot,
  findUpPath,
  LLM_PRESETS,
  listProfilePresets,
  loadEnv,
  loadProfile,
  maskSecret,
  mergeEnvFileContent,
  parseEnvFile,
  parseFlags,
  planProfileWrite,
  readProfileFile,
  resolveScoutBudget,
  saveProfileYaml,
  stringFlag,
  type AppEnv,
  type ProfileSelection,
  type ScoutBudgetName
} from "../packages/shared/src/index.js";
import { callLlm } from "../packages/intelligence/src/llm-client.js";
import { draftProfileYaml, editProfileYaml } from "../packages/intelligence/src/profile-draft.js";
import {
  findTelegramChats,
  getTelegramBotUsername,
  sendTelegramMessage,
  type TelegramChat
} from "../packages/notify/src/telegram.js";

const FLAG_SPEC = {
  provider: "string",
  "api-key-env": "string",
  profile: "string",
  budget: "string",
  verify: "boolean",
  yes: "boolean",
  root: "string"
} as const;

const SECRET_KEYS = new Set(["LLM_API_KEY", "EXA_API_KEY", "X_BEARER_TOKEN", "FIRECRAWL_API_KEY", "TELEGRAM_BOT_TOKEN", "DATABASE_URL"]);

const FALLBACK_ENV_TEMPLATE = [
  "# Created by `pnpm onboard`. See .env.example for the full list of variables.",
  "MOCK_MODE=true",
  "",
  "SCOUT_PROFILE=",
  "SCOUT_BUDGET=small",
  "",
  "LLM_PROVIDER=",
  "LLM_API_KEY=",
  "LLM_MODEL=",
  "LLM_BASE_URL=",
  "",
  "EXA_API_KEY=",
  "X_BEARER_TOKEN=",
  "FIRECRAWL_API_KEY=",
  "",
  "DATABASE_URL=",
  "",
  "TELEGRAM_BOT_TOKEN=",
  "TELEGRAM_CHAT_ID=",
  ""
].join("\n");

interface Io {
  question(prompt: string): Promise<string>;
  questionSecret(prompt: string): Promise<string>;
  close(): void;
}

async function main(): Promise<void> {
  const { flags } = parseFlags(process.argv.slice(2), FLAG_SPEC);
  const nonInteractive = booleanFlag(flags, "yes");
  const rootFlag = stringFlag(flags, "root");

  // Interactive mode needs a real terminal to prompt on. Without one (piped/redirected stdin,
  // a CI job, ...), every question would block forever or read garbage, so fail fast with a
  // clear message instead of hanging or (worse) silently running through with empty answers.
  if (!nonInteractive && !process.stdin.isTTY) {
    console.error(
      "This terminal has no interactive input (stdin is not a TTY), so the wizard cannot prompt for answers.\n" +
        "Re-run non-interactively with --yes and the flags you need, for example:\n" +
        "  pnpm onboard --yes [--provider <name>] [--api-key-env <VAR>] [--profile <preset|default>] [--verify]"
    );
    process.exitCode = 1;
    return;
  }

  let wizardFinished = false;
  installTerminalSafetyNets(nonInteractive, () => wizardFinished);

  const root = rootFlag ? resolve(process.cwd(), rootFlag) : findRepoRoot(process.cwd());
  if (!root) {
    throw new Error(
      "Could not find the repo root (no pnpm-workspace.yaml above the current directory). " +
        "Run this from inside the project, or pass --root <dir>."
    );
  }

  console.log("Bay Area Event Scout — onboarding");
  console.log(
    "This asks a few questions about your LLM, search keys, Telegram, preferences, and budget, then\n" +
      `writes ${join(root, ".env.local")} (and optionally scout.profile.yaml) so real scans work.\n`
  );

  const envLocalPath = join(root, ".env.local");
  const existingEnvContent = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : undefined;
  const existingValues = existingEnvContent ? parseEnvFile(existingEnvContent) : {};

  const io = createIo();
  const updates: Record<string, string> = {};

  try {
    await configureLlm({ io, flags, nonInteractive, existingValues, updates });
    await configureDiscovery({ io, nonInteractive, existingValues, updates });
    await configureTelegram({ io, nonInteractive, existingValues, updates });
    await configureCloudResults({ io, nonInteractive, existingValues, updates });
    await configurePreferences({ io, flags, nonInteractive, root, existingValues, updates });
    await configureBudget({ io, flags, nonInteractive, existingEnvFile: existingEnvContent !== undefined, existingValues, updates });
    await finalizeMode({ io, nonInteractive, existingValues, updates });

    const templateContent = existingEnvContent ?? readEnvExampleTemplate(root);
    const merged = mergeEnvFileContent(templateContent, updates);
    writeFileSync(envLocalPath, merged, "utf8");
    chmodSync(envLocalPath, 0o600);

    printSummary(envLocalPath, updates);
    printNextSteps(updates.MOCK_MODE !== "false");
  } finally {
    wizardFinished = true;
    io.close();
  }
}

/**
 * Two safety nets so a broken or truncated input stream never leaves the wizard hanging, or
 * silently succeeding with unanswered prompts, or the user's terminal stuck in raw mode:
 *
 * - stdin ending (EOF) before the wizard is done: unexpected in interactive mode (a real TTY does
 *   not emit `end` on its own; this only fires for a closed/exhausted input, e.g. a broken pty in
 *   a test harness, the user pressing Ctrl+D, or a piped input file that ran out). Exit non-zero
 *   with a clear message instead of letting the process fall through and exit 0. Only armed in
 *   interactive mode: `--yes` never reads a prompt, so an idle readline interface over a
 *   non-TTY/already-closed stdin (piped from /dev/null in scripts and CI) can hit EOF almost
 *   immediately without that being a problem at all.
 * - SIGINT/SIGTERM while a masked prompt has stdin in raw mode: restore normal mode first so the
 *   user is not left with a terminal that echoes nothing and ignores Ctrl+C. Safe to install
 *   unconditionally since it only touches raw mode when stdin is actually a TTY.
 */
function installTerminalSafetyNets(nonInteractive: boolean, isFinished: () => boolean): void {
  if (!nonInteractive) {
    process.stdin.on("end", () => {
      if (isFinished()) return;
      console.error("\nInput ended before the wizard finished (unexpected EOF). Re-run interactively, or use --yes with flags.");
      process.exit(1);
    });
  }

  const restoreAndExit = (signal: "SIGINT" | "SIGTERM"): void => {
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // best-effort: nothing more we can do if the tty is already gone
      }
    }
    process.stdout.write("\nCancelled.\n");
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => restoreAndExit("SIGINT"));
  process.on("SIGTERM", () => restoreAndExit("SIGTERM"));
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

async function configureLlm(input: {
  io: Io;
  flags: ReturnType<typeof parseFlags>["flags"];
  nonInteractive: boolean;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<void> {
  const { io, flags, nonInteractive, existingValues, updates } = input;
  const presetKeys = Object.keys(LLM_PRESETS);
  // Normalize "" to undefined: a present-but-empty LLM_PROVIDER= line (e.g. left blank by a
  // previous run) must behave exactly like an absent one, so "none" -- not an empty string that
  // matches nothing in the menu -- is the working default blank Enter resolves to.
  const currentProvider = existingValues.LLM_PROVIDER?.trim() || undefined;

  let providerChoice: string;
  if (nonInteractive) {
    providerChoice = (stringFlag(flags, "provider") ?? currentProvider ?? "none").toLowerCase();
    if (providerChoice !== "none" && !LLM_PRESETS[providerChoice]) {
      throw new Error(`--provider ${providerChoice} is not supported. Use one of: ${presetKeys.join(", ")}, or none.`);
    }
  } else {
    console.log("LLM provider (used to extract event details and score events against your preferences).");
    console.log("Not sure? Pick openai. docs/setup-and-costs.md compares the options, including free ones.\n");
    presetKeys.forEach((key, index) => {
      const current = key === currentProvider ? "  [current]" : "";
      const recommended = key === "openai" ? " (recommended)" : "";
      console.log(`  ${index + 1}) ${key} — ${LLM_PRESETS[key].label}${recommended}${current}`);
    });
    const noneIndex = presetKeys.length + 1;
    console.log(`  ${noneIndex}) none (mock mode only; real scans need an LLM)${currentProvider ? "" : "  [current]"}`);

    providerChoice = await promptChoice(io, "Enter a number or name", [...presetKeys, "none"], currentProvider ?? "none");
  }

  if (providerChoice === "none") {
    updates.LLM_PROVIDER = "";
    console.log("No LLM for now: mock mode works, but real scans need one to read event pages.\n");
    return;
  }

  const preset = LLM_PRESETS[providerChoice];
  updates.LLM_PROVIDER = providerChoice;

  if (providerChoice === "openai-compatible") {
    if (nonInteractive) {
      console.log(
        "Note: --provider openai-compatible needs LLM_BASE_URL and LLM_MODEL; the non-interactive " +
          "flags do not set these yet, so edit .env.local by hand afterward (or run `pnpm onboard` interactively)."
      );
    } else {
      updates.LLM_BASE_URL = await requireNonEmptyWithDefault(
        io,
        `Base URL for ${providerChoice} (e.g. https://api.groq.com/openai/v1)`,
        existingValues.LLM_BASE_URL?.trim()
      );
      updates.LLM_MODEL = await requireNonEmptyWithDefault(io, "Model id for that endpoint", existingValues.LLM_MODEL?.trim());
    }
  } else if (!nonInteractive) {
    const defaultModels = preset.models;
    console.log(
      `Default models for ${providerChoice}: extract=${defaultModels.extract} score=${defaultModels.score} fast=${defaultModels.fast}`
    );
    const override = await io.question("Use a different model for all three tasks? (leave blank to keep the defaults): ");
    if (override.trim()) updates.LLM_MODEL = override.trim();
  }

  // Ollama truly never needs a key; every other provider (including openai-compatible, where
  // "optional" just means "some endpoints are open") is at least worth asking about.
  if (providerChoice === "ollama") {
    console.log("Ollama runs locally; no API key needed.");
  } else if (nonInteractive) {
    const keyEnvVar = stringFlag(flags, "api-key-env");
    const apiKey = keyEnvVar ? process.env[keyEnvVar] : undefined;
    if (apiKey) {
      updates.LLM_API_KEY = apiKey;
    } else if (!preset.keyOptional && !existingValues.LLM_API_KEY) {
      throw new Error(
        `Provider ${providerChoice} needs an API key. Pass --api-key-env <VAR> naming an already-exported ` +
          "environment variable that holds the key."
      );
    }
  } else {
    const existingKey = existingValues.LLM_API_KEY;
    const requirement = preset.keyOptional ? "leave blank if your endpoint does not need one" : "required";
    const prompt = existingKey
      ? `API key for ${providerChoice} (${requirement}; current: ${maskSecret(existingKey)}; press Enter to keep it): `
      : `API key for ${providerChoice} (${requirement}): `;
    const typed = await io.questionSecret(prompt);
    const apiKey = typed || existingKey;
    if (apiKey) {
      updates.LLM_API_KEY = apiKey;
    } else if (!preset.keyOptional) {
      console.log("No key entered; the LLM will stay disabled until you add one.");
    }
  }

  const verify = nonInteractive
    ? booleanFlag(flags, "verify")
    : await confirm(io, "Verify this key with one tiny request now?", true);

  if (verify) await verifyLlmKey({ existingValues, updates });
  console.log();
}

async function verifyLlmKey(input: { existingValues: NodeJS.ProcessEnv; updates: Record<string, string> }): Promise<void> {
  const merged = { ...process.env, ...input.existingValues, ...input.updates };
  const env: AppEnv = loadEnv(merged);
  if (!env.llm.enabled) {
    console.log(`Skipping verification: ${env.llm.disabledReason}`);
    return;
  }
  try {
    const reply = await callLlm({ env, model: env.llm.models.fast, prompt: "Reply with only the single word OK." });
    console.log(`Success: ${env.llm.provider} (${env.llm.models.fast}) responded: ${reply.slice(0, 60)}`);
  } catch (error) {
    console.log(`Could not verify the key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Discovery connectors
// ---------------------------------------------------------------------------

async function configureDiscovery(input: {
  io: Io;
  nonInteractive: boolean;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<void> {
  if (input.nonInteractive) return;
  const { io, existingValues, updates } = input;

  console.log("Discovery connectors (all optional, but at least one is recommended for real mode):\n");

  const exa = await promptOptionalSecret(
    io,
    "EXA_API_KEY",
    existingValues.EXA_API_KEY,
    "Web search for events. Recommended: $20 of free credit, then about $0.21 per small scan (dashboard.exa.ai)."
  );
  if (exa !== undefined) updates.EXA_API_KEY = exa;

  const x = await promptOptionalSecret(
    io,
    "X_BEARER_TOKEN",
    existingValues.X_BEARER_TOKEN,
    "Catches events hosts only share on X. Paid: $0.005 per post read, about $4-23 a month (developer.x.com)."
  );
  if (x !== undefined) updates.X_BEARER_TOKEN = x;

  const firecrawl = await promptOptionalSecret(
    io,
    "FIRECRAWL_API_KEY",
    existingValues.FIRECRAWL_API_KEY,
    "Improves page fetching on JS-heavy pages; free up to 1,000 pages a month. Without it, pages are fetched directly."
  );
  if (firecrawl !== undefined) updates.FIRECRAWL_API_KEY = firecrawl;

  console.log();
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

async function configureTelegram(input: {
  io: Io;
  nonInteractive: boolean;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<void> {
  if (input.nonInteractive) return;
  const { io, existingValues, updates } = input;

  console.log("Telegram digest (optional, free): get the picks as a Telegram message after each scan.");
  console.log("Without it, the digest only prints here in the terminal.\n");
  if (!existingValues.TELEGRAM_BOT_TOKEN) {
    console.log("To make a bot: in Telegram, open @BotFather, send /newbot, and pick a name and a username");
    console.log("ending in \"bot\". BotFather replies with a token like 123456789:AAH... Paste it below.");
  }

  const botToken = await promptOptionalSecret(io, "TELEGRAM_BOT_TOKEN", existingValues.TELEGRAM_BOT_TOKEN, "From @BotFather.");
  if (botToken !== undefined) updates.TELEGRAM_BOT_TOKEN = botToken;
  const finalBotToken = updates.TELEGRAM_BOT_TOKEN ?? existingValues.TELEGRAM_BOT_TOKEN;
  if (!finalBotToken) {
    console.log();
    return;
  }

  let botUsername: string;
  try {
    botUsername = await getTelegramBotUsername(finalBotToken);
    console.log(`  Token works: this is @${botUsername}.`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // A token Telegram itself rejects would only make every scan fail to send, so it is not saved.
    // Anything else (offline, a timeout) might be temporary, so the token is kept.
    const rejected = /unauthorized|not found/i.test(reason);
    if (rejected && botToken !== undefined) delete updates.TELEGRAM_BOT_TOKEN;
    console.log(`  Telegram did not accept that token (${reason}).${rejected && botToken !== undefined ? " It was not saved." : ""}`);
    console.log(`  Check it in @BotFather (/mybots), then run \`${commandHint("onboard")}\` again.\n`);
    return;
  }

  const chatIdCurrent = existingValues.TELEGRAM_CHAT_ID?.trim();
  const chatId = chatIdCurrent && !(await confirm(io, `Send the digest somewhere other than chat ${chatIdCurrent}?`, false))
    ? chatIdCurrent
    : await pickTelegramChat(io, finalBotToken, botUsername);
  if (chatId) updates.TELEGRAM_CHAT_ID = chatId;

  if (chatId && chatId !== chatIdCurrent) {
    const sendTest = await confirm(io, "Send a test message to check it arrives?", true);
    if (sendTest) {
      try {
        await sendTelegramMessage({ botToken: finalBotToken, chatId, text: "Bay Area Event Scout: this is where your event picks will arrive." });
        console.log("  Sent. Check Telegram for the message.");
      } catch (error) {
        console.log(`  Could not send the test message: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log();
}

/**
 * Finds the chat to send digests to without making anyone read a chat id out of JSON: the person
 * messages the bot, and we list the chats Telegram reports. Typing an id by hand still works.
 */
async function pickTelegramChat(io: Io, botToken: string, botUsername: string): Promise<string | undefined> {
  console.log(`\nNow open Telegram, find @${botUsername}, and press Start (or send it any message).`);
  console.log("For a group digest, add the bot to the group and send a message there instead.");
  for (;;) {
    const typed = (await io.question("Press Enter once you've sent it (or type a chat id, or \"skip\"): ")).trim();
    if (typed.toLowerCase() === "skip") return undefined;
    if (typed) return typed;

    let chats: TelegramChat[];
    try {
      chats = await findTelegramChats(botToken);
    } catch (error) {
      console.log(`  Could not ask Telegram for recent messages (${error instanceof Error ? error.message : String(error)}).`);
      continue;
    }
    if (!chats.length) {
      console.log(`  No messages to @${botUsername} yet. Send it a message, then press Enter again.`);
      continue;
    }
    if (chats.length === 1) {
      const [chat] = chats;
      console.log(`  Found ${chat.name} (${chat.type === "private" ? "private chat" : chat.type}).`);
      return chat.id;
    }
    chats.forEach((chat, index) => console.log(`  ${index + 1}) ${chat.name} (${chat.type === "private" ? "private chat" : chat.type})`));
    const answer = (await io.question(`Which one gets the digest? [1]: `)).trim();
    const choice = chats[(answer ? Number(answer) : 1) - 1];
    if (choice) return choice.id;
    console.log("  That is not one of the numbers above.");
  }
}

/**
 * For people whose scans run in the cloud (GitHub Actions or Trigger.dev) and save to Postgres:
 * the same DATABASE_URL here makes the local dashboard show those results.
 */
async function configureCloudResults(input: {
  io: Io;
  nonInteractive: boolean;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<void> {
  if (input.nonInteractive) return;
  const { io, existingValues, updates } = input;
  console.log("Cloud results (optional). Skip this unless your scans also run in the cloud (GitHub Actions or");
  console.log("Trigger.dev) and save to a Postgres database; paste that same DATABASE_URL to see those results here.\n");
  const databaseUrl = await promptOptionalSecret(
    io,
    "DATABASE_URL",
    existingValues.DATABASE_URL,
    "Postgres connection string, e.g. postgresql://user:password@host/db?sslmode=require"
  );
  if (databaseUrl !== undefined) updates.DATABASE_URL = databaseUrl;
  console.log();
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

async function configurePreferences(input: {
  io: Io;
  flags: ReturnType<typeof parseFlags>["flags"];
  nonInteractive: boolean;
  root: string;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<void> {
  const { io, flags, nonInteractive, root, existingValues, updates } = input;
  const presets = listProfilePresets(root);

  if (nonInteractive) {
    const choice = stringFlag(flags, "profile");
    if (choice === undefined) {
      // No --profile given: mirror --provider's fallback and keep whatever SCOUT_PROFILE already
      // is (including "keep nothing configured") rather than clearing it on every re-run.
      return;
    }
    if (choice === "default") {
      updates.SCOUT_PROFILE = "";
      return;
    }
    if (!presets.includes(choice)) {
      throw new Error(`--profile ${choice} is not a known preset. Available: ${presets.join(", ") || "(none found)"}, or "default".`);
    }
    updates.SCOUT_PROFILE = choice;
    return;
  }

  console.log("Preferences: which events should the scout look for?\n");
  // Blank Enter must keep whatever is already configured, and only fall back to the built-in
  // default when nothing is configured at all -- otherwise re-running the wizard and pressing
  // Enter through this question silently resets an existing SCOUT_PROFILE (e.g. "fintech").
  const currentChoice = existingValues.SCOUT_PROFILE?.trim() || undefined;
  const currentPresetIndex = currentChoice ? presets.indexOf(currentChoice) : -1;
  const current = describeCurrentProfile(root, existingValues);
  console.log(`Right now: ${current.label}\n`);

  presets.forEach((name, index) => {
    const profile = readProfileFile(findUpPath(root, `profiles/${name}.yaml`) ?? findUpPath(root, `profiles/${name}.yml`)!);
    const marker = index === currentPresetIndex ? "  [current]" : "";
    console.log(`  ${index + 1}) preset "${name}": ${profile.persona}${marker}`);
  });

  const keepIndex = presets.length + 1;
  const describeIndex = presets.length + 2;
  const changeIndex = presets.length + 3;
  // The "keep" line only gets the [current] marker when no listed preset above already claimed
  // it: either nothing is configured, a scout.profile.yaml is in use, or SCOUT_PROFILE points to a
  // custom path.
  const keepIsCurrent = currentPresetIndex === -1;
  console.log(`  ${keepIndex}) keep the current preferences${keepIsCurrent ? "  [current]" : ""}`);
  console.log(`  ${describeIndex}) describe yourself in a sentence; your LLM writes new preferences`);
  console.log(`  ${changeIndex}) change the current preferences with a sentence (e.g. "add climate tech", "no crypto")`);

  const defaultIndex = currentPresetIndex >= 0 ? currentPresetIndex + 1 : keepIndex;
  const answer = (await io.question(`Enter a number [${defaultIndex}]: `)).trim();
  const choiceIndex = answer ? Number(answer) : defaultIndex;

  if (Number.isInteger(choiceIndex) && choiceIndex >= 1 && choiceIndex <= presets.length) {
    updates.SCOUT_PROFILE = presets[choiceIndex - 1];
    if (current.isCustomFile) {
      console.log(`(Your ${current.fileLabel} stays on disk, but the preset is used while SCOUT_PROFILE selects it.)`);
    }
    console.log();
    return;
  }

  if (choiceIndex === describeIndex || choiceIndex === changeIndex) {
    const saved =
      choiceIndex === describeIndex
        ? await describeYourself({ io, root, existingValues, updates })
        : await changeCurrentPreferences({ io, root, existingValues, updates });
    if (saved) {
      console.log();
      return;
    }
  }

  // "Keep" (explicit choice, blank Enter, an unrecognized answer, or an LLM step that did not
  // save anything): only the built-in default needs an explicit "" written; anything already
  // configured is left completely untouched.
  if (!currentChoice) {
    updates.SCOUT_PROFILE = "";
  }
  console.log();
}

/** What the scout would use right now, before this wizard changes anything. */
function describeCurrentProfile(
  root: string,
  existingValues: NodeJS.ProcessEnv
): { label: string; isCustomFile: boolean; fileLabel?: string } {
  try {
    const selection = loadProfile({ cwd: root, env: { ...existingValues, ...process.env } });
    const isCustomFile = selection.selectedBy === "file" || selection.selectedBy === "path";
    return { label: `${selection.source}: ${selection.profile.persona}`, isCustomFile, fileLabel: selection.source };
  } catch (error) {
    return { label: `a profile that does not load (${error instanceof Error ? error.message : String(error)})`, isCustomFile: false };
  }
}

function llmForPreferences(existingValues: NodeJS.ProcessEnv, updates: Record<string, string>): AppEnv | undefined {
  const env: AppEnv = loadEnv({ ...process.env, ...existingValues, ...updates });
  if (env.llm.enabled) return env;
  console.log(
    `This option uses your LLM, which is not set up (${env.llm.disabledReason}). ` +
      `Keeping the current preferences; you can run \`${commandHint("profile:edit")}\` once an LLM is configured.`
  );
  return undefined;
}

async function describeYourself(input: {
  io: Io;
  root: string;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<boolean> {
  const { io, root, existingValues, updates } = input;
  const env = llmForPreferences(existingValues, updates);
  if (!env) return false;

  console.log('For example: "I run partnerships at a B2B SaaS startup and want small dinners with');
  console.log('founders and enterprise buyers; climate tech is interesting too; no crypto".');
  const description = await io.question("Describe yourself (any language is fine): ");
  if (!description.trim()) {
    console.log("Nothing entered. Keeping the current preferences.");
    return false;
  }

  console.log(`Asking ${env.llm.provider} to write your preferences...`);
  let draft;
  try {
    draft = await draftProfileYaml(description, env);
  } catch (error) {
    console.log(`Could not write preferences: ${error instanceof Error ? error.message : String(error)}. Keeping the current ones.`);
    return false;
  }

  console.log("\nHere is what the scout would look for:\n");
  for (const line of describeProfile(draft.profile)) console.log(`  ${line}`);
  if (draft.sourcesWereStripped) {
    console.log(
      "\n  Note: the draft included a `sources` key; it was ignored (an LLM cannot know your real " +
        "calendar/feed/X URLs). Add sources by hand under `sources:` in scout.profile.yaml if you want them."
    );
  }

  if (!(await confirm(io, "\nUse these preferences?", true))) {
    console.log("Discarded. Keeping the current preferences.");
    return false;
  }
  return savePreferences({ root, existingValues, updates, yaml: draft.yaml });
}

async function changeCurrentPreferences(input: {
  io: Io;
  root: string;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<boolean> {
  const { io, root, existingValues, updates } = input;
  const env = llmForPreferences(existingValues, updates);
  if (!env) return false;
  const selection = currentSelection(root, existingValues);
  if (!selection) {
    console.log("The current preferences do not load, so there is nothing to change. Keeping them as they are.");
    return false;
  }

  console.log("\nThe scout currently looks for:\n");
  for (const line of describeProfile(selection.profile)) console.log(`  ${line}`);
  const instruction = await io.question('\nWhat would you like to change? (e.g. "add climate tech", "no crypto events"): ');
  if (!instruction.trim()) {
    console.log("Nothing entered. Keeping the current preferences.");
    return false;
  }

  console.log(`Asking ${env.llm.provider} to update your preferences...`);
  let result;
  try {
    result = await editProfileYaml({ currentYaml: readSelectionYaml(root, selection), instruction, env });
  } catch (error) {
    console.log(`Could not update them: ${error instanceof Error ? error.message : String(error)}. Keeping the current ones.`);
    return false;
  }
  if (!result.changes.length) {
    console.log("The LLM did not change anything. Keeping the current preferences.");
    return false;
  }

  console.log("\nHere is what would change:\n");
  for (const line of result.changes) console.log(`  ${line}`);
  if (!(await confirm(io, "\nSave these changes?", true))) {
    console.log("Not saved. Keeping the current preferences.");
    return false;
  }
  return savePreferences({ root, existingValues, updates, yaml: result.yaml });
}

function currentSelection(root: string, existingValues: NodeJS.ProcessEnv): ProfileSelection | undefined {
  try {
    return loadProfile({ cwd: root, env: { ...existingValues, ...process.env } });
  } catch {
    return undefined;
  }
}

function readSelectionYaml(root: string, selection: ProfileSelection): string {
  if (selection.path) return readFileSync(selection.path, "utf8");
  const presetPath = join(root, "profiles", `${DEFAULT_PROFILE_NAME}.yaml`);
  return existsSync(presetPath) ? readFileSync(presetPath, "utf8") : `${JSON.stringify(DEFAULT_PROFILE, null, 2)}\n`;
}

/**
 * Saves new preferences where scans will pick them up (see planProfileWrite), backing up the
 * previous version for `pnpm profile:undo`. SCOUT_PROFILE is switched off through `updates`, since
 * this wizard writes .env.local itself at the end.
 */
function savePreferences(input: {
  root: string;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
  yaml: string;
}): boolean {
  const { root, existingValues, updates, yaml } = input;
  const loaded = currentSelection(root, existingValues);
  const selection: ProfileSelection = loaded ?? {
    profile: DEFAULT_PROFILE,
    source: "the previous profile",
    selectedBy: existingValues.SCOUT_PROFILE?.trim() ? "preset" : "default"
  };
  const plan = planProfileWrite({ root, selection, processScoutProfile: process.env.SCOUT_PROFILE });
  const previousYaml = loaded ? readSelectionYaml(root, loaded) : undefined;
  saveProfileYaml({ root, plan: { ...plan, clearScoutProfileInEnvLocal: false }, yaml, previousYaml });
  if (plan.clearScoutProfileInEnvLocal || selection.selectedBy === "preset") updates.SCOUT_PROFILE = "";
  console.log(`Saved to ${plan.targetPath} (the previous version is kept for \`${commandHint("profile:undo")}\`).`);
  if (plan.scoutProfileSetElsewhere) {
    console.log(`Heads up: ${plan.scoutProfileSetElsewhere}, so scans keep using ${selection.source} until you remove it.`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

const BUDGET_CHOICES: Array<{ name: ScoutBudgetName; label: string }> = [
  { name: "small", label: "small:  about $0.25 a scan (one scan a day is about $2 a month)" },
  { name: "medium", label: "medium: about $0.50 a scan (two a day is about $20 a month)" },
  { name: "large", label: "large:  about $1 a scan, plus X (three a day is about $80-130 a month)" }
];

function currentBudget(value: string | undefined, existingEnvFile: boolean): ScoutBudgetName | undefined {
  if (!value?.trim()) return existingEnvFile ? "large" : undefined;
  try {
    return resolveScoutBudget(value);
  } catch {
    return undefined; // an unknown value gets replaced by whatever is picked now
  }
}

async function configureBudget(input: {
  io: Io;
  flags: ReturnType<typeof parseFlags>["flags"];
  nonInteractive: boolean;
  existingEnvFile: boolean;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<void> {
  const { io, flags, nonInteractive, existingEnvFile, existingValues, updates } = input;
  if (nonInteractive) {
    const choice = stringFlag(flags, "budget");
    if (choice !== undefined) updates.SCOUT_BUDGET = resolveScoutBudget(choice);
    return;
  }

  // A brand-new setup starts small; re-running the wizard keeps whatever is in effect (an older
  // .env.local without SCOUT_BUDGET has always meant large).
  const current = currentBudget(existingValues.SCOUT_BUDGET, existingEnvFile);
  const defaultName = current ?? "small";
  console.log("Budget: how much may one scan spend? You pay each provider directly; the scout stays under");
  console.log("these caps. Details and cheaper setups: docs/setup-and-costs.md\n");
  BUDGET_CHOICES.forEach((choice, index) => {
    console.log(`  ${index + 1}) ${choice.label}${choice.name === current ? "  [current]" : ""}`);
  });
  const defaultIndex = BUDGET_CHOICES.findIndex((choice) => choice.name === defaultName) + 1;
  const answer = (await io.question(`Enter a number [${defaultIndex}]: `)).trim().toLowerCase();
  const picked = BUDGET_CHOICES[(answer ? Number(answer) : defaultIndex) - 1] ?? BUDGET_CHOICES.find((choice) => choice.name === answer);
  updates.SCOUT_BUDGET = picked?.name ?? defaultName;
  console.log();
}

// ---------------------------------------------------------------------------
// Mode, file writing, summary
// ---------------------------------------------------------------------------

async function finalizeMode(input: {
  io: Io;
  nonInteractive: boolean;
  existingValues: NodeJS.ProcessEnv;
  updates: Record<string, string>;
}): Promise<void> {
  const { io, nonInteractive, existingValues, updates } = input;
  const finalValue = (key: string): string | undefined => {
    const updated = updates[key];
    return updated !== undefined ? updated : existingValues[key];
  };

  const merged = { ...process.env, ...existingValues, ...updates };
  const llm = loadEnv(merged).llm;
  const hasDiscoveryKey = isSet(finalValue("EXA_API_KEY")) || isSet(finalValue("X_BEARER_TOKEN"));

  // Real scans need an LLM to read event pages. Discovery keys are not required: without Exa or X
  // the scout still reads the free public calendars and RSS feeds, it just finds fewer events.
  if (!llm.enabled) {
    updates.MOCK_MODE = "true";
    console.log("Keeping mock mode: no LLM is configured. Mock mode runs the full pipeline on sample data.");
    return;
  }
  const realModeNote = hasDiscoveryKey
    ? "Real mode: an LLM and a discovery connector are configured."
    : "Real mode: an LLM is configured. Without Exa or X, scans read the free public calendars and RSS feeds only.";

  // Flipping straight to real mode without asking means the very next run silently starts
  // spending API credits and (with Telegram configured) sending real messages, so ask first when
  // there is someone to ask; --yes keeps the automatic decision but still prints it clearly.
  if (nonInteractive) {
    updates.MOCK_MODE = "false";
    console.log(realModeNote);
    return;
  }

  const useReal = await confirm(
    io,
    "Use real mode by default? The dashboard will show your real results instead of sample data, and real scans spend API credits.",
    true
  );
  if (useReal) {
    updates.MOCK_MODE = "false";
    console.log(realModeNote);
  } else {
    updates.MOCK_MODE = "true";
    console.log(`Keeping mock mode. Run \`${commandHint("onboard")}\` again anytime to switch to real mode.`);
  }
}

function isSet(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

function readEnvExampleTemplate(root: string): string {
  const examplePath = join(root, ".env.example");
  return existsSync(examplePath) ? readFileSync(examplePath, "utf8") : FALLBACK_ENV_TEMPLATE;
}

function printSummary(envLocalPath: string, updates: Record<string, string>): void {
  console.log(`\nWrote ${envLocalPath}:`);
  for (const [key, value] of Object.entries(updates)) {
    const display = value === "" ? "(not set)" : SECRET_KEYS.has(key) ? maskSecret(value) : value;
    console.log(`  ${key}=${display}`);
  }
}

function printNextSteps(mockMode: boolean): void {
  // `npm start` goes straight on to its menu (scan, dashboard, ...), so it needs no to-do list.
  if (process.env.SCOUT_LAUNCHER === "npm-start") return;
  if (mockMode) {
    console.log(
      "\nNext steps:\n" +
        "  pnpm scout:mock # run the full pipeline on sample data\n" +
        "  pnpm admin      # open the dashboard at http://127.0.0.1:4310\n" +
        "  pnpm onboard    # once you have an LLM and a discovery key, re-run this to switch to real mode\n"
    );
  } else {
    console.log(
      "\nNext steps:\n" +
        "  pnpm scout:doctor --live # confirm your keys actually work\n" +
        "  pnpm scout:real          # run a real scan\n" +
        "  pnpm admin               # open the dashboard at http://127.0.0.1:4310\n"
    );
  }
}

// ---------------------------------------------------------------------------
// Small interactive-IO helpers
// ---------------------------------------------------------------------------

function createIo(): Io {
  let rl: Interface = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async question(prompt: string): Promise<string> {
      return (await rl.question(prompt)).trim();
    },
    async questionSecret(prompt: string): Promise<string> {
      if (!process.stdin.isTTY) {
        return (await rl.question(prompt)).trim();
      }
      rl.close();
      try {
        return await readMaskedLine(prompt);
      } finally {
        rl = createInterface({ input: process.stdin, output: process.stdout });
      }
    },
    close(): void {
      rl.close();
    }
  };
}

// Raw-mode masked input for secrets. Compares raw byte VALUES (not characters), so this file
// never has to embed literal control-character bytes (Enter/Ctrl+C/Backspace) in its own source.
// These are all single-byte ASCII values, so they can never collide with a UTF-8 lead or
// continuation byte (all >= 0x80), which is what lets the loop below scan control bytes one at a
// time while still decoding everything else as UTF-8 (see `decoder` below).
const ENTER_BYTES = new Set([13, 10]);
const CTRL_C_BYTE = 3;
const BACKSPACE_BYTES = new Set([127, 8]);

/** Removes the last full Unicode code point (not just the last UTF-16 code unit), so backspacing
 * over a character outside the BMP (e.g. an emoji) does not leave an unpaired surrogate behind. */
function removeLastCodePoint(value: string): string {
  const codePoints = Array.from(value);
  codePoints.pop();
  return codePoints.join("");
}

function readMaskedLine(promptText: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdin = process.stdin;
    process.stdout.write(promptText);
    let value = "";
    // Decodes UTF-8 a byte at a time, correctly buffering a multi-byte character's leading bytes
    // until the sequence completes (whether it arrives in one paste or split across keystrokes)
    // instead of the old per-byte `String.fromCharCode`, which turned each byte of e.g. "café"
    // into its own mojibake character.
    const decoder = new StringDecoder("utf8");

    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: Buffer): void => {
      for (let index = 0; index < chunk.length; index += 1) {
        const byte = chunk[index];
        if (ENTER_BYTES.has(byte)) {
          // A pasted value with an embedded line break: keep only the text before the first
          // break as the value (matching plain Enter), but tell the user if real content after
          // it is being thrown away, instead of silently dropping it.
          const remainder = chunk.subarray(index + 1);
          const extraIgnored = hasNonWhitespaceByte(remainder);
          cleanup();
          process.stdout.write("\n");
          if (extraIgnored) {
            process.stdout.write("(extra pasted text after the first line was ignored)\n");
          }
          resolvePromise(value);
          return;
        }
        if (byte === CTRL_C_BYTE) {
          cleanup();
          process.stdout.write("\n");
          rejectPromise(new Error("Cancelled"));
          return;
        }
        if (BACKSPACE_BYTES.has(byte)) {
          if (value.length) {
            value = removeLastCodePoint(value);
            process.stdout.write("\b \b");
          }
          continue;
        }
        // Feed one raw byte at a time to the UTF-8 decoder: it returns "" while a multi-byte
        // sequence is still incomplete, and the decoded character(s) once it is, so `piece` never
        // contains more than the one character that single byte just completed.
        const piece = decoder.write(Buffer.from([byte]));
        if (piece) {
          value += piece;
          process.stdout.write("*".repeat(Array.from(piece).length));
        }
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function hasNonWhitespaceByte(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte !== 32 && byte !== 9 && byte !== 13 && byte !== 10) return true;
  }
  return false;
}

async function confirm(io: Io, promptLabel: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await io.question(`${promptLabel} [${hint}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

async function promptChoice(io: Io, label: string, keys: string[], current: string): Promise<string> {
  const defaultIndex = keys.indexOf(current);
  const hint = defaultIndex >= 0 ? ` [${defaultIndex + 1}]` : "";
  for (;;) {
    const answer = (await io.question(`${label}${hint}: `)).trim();
    if (!answer && defaultIndex >= 0) return keys[defaultIndex];
    const byNumber = Number(answer);
    if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= keys.length) return keys[byNumber - 1];
    const byName = keys.find((key) => key.toLowerCase() === answer.toLowerCase());
    if (byName) return byName;
    console.log(`Not a valid choice: "${answer}"`);
  }
}

async function requireNonEmpty(io: Io, prompt: string): Promise<string> {
  for (;;) {
    const value = (await io.question(prompt)).trim();
    if (value) return value;
    console.log("This value is required.");
  }
}

/**
 * Like `requireNonEmpty`, but when a value is already configured, shows it and lets a blank
 * Enter keep it — matching every other re-run-friendly prompt in this wizard (API key, profile
 * choice, ...). Without this, re-running the wizard for an already-configured openai-compatible
 * endpoint forced retyping the exact same LLM_BASE_URL and LLM_MODEL every time.
 */
async function requireNonEmptyWithDefault(io: Io, label: string, current: string | undefined): Promise<string> {
  if (!current) return requireNonEmpty(io, `${label}: `);
  const typed = await io.question(`${label} (current: ${current}; press Enter to keep it): `);
  return typed || current;
}

async function promptOptionalSecret(
  io: Io,
  name: string,
  current: string | undefined,
  description: string
): Promise<string | undefined> {
  console.log(`${name}: ${description}`);
  const prompt = current
    ? `  current: ${maskSecret(current)}; press Enter to keep it, or type a new value: `
    : "  leave blank to skip: ";
  const typed = await io.questionSecret(prompt);
  return typed || undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
