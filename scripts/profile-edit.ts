/**
 * Shows or changes your preferences (the scout profile) in plain language, using your configured LLM.
 *
 *   pnpm profile:show                                    # what the scout is looking for right now
 *   pnpm profile:edit                                    # shows it, then asks what to change
 *   pnpm profile:edit "add climate tech, and never show crypto events"
 *   pnpm profile:edit --yes "raise the bar a little"     # scripting: save without asking
 *   pnpm profile:undo                                    # put the previous version back (run again to redo)
 *   pnpm profile:edit --root <dir> ...                   # use a different project folder (tests)
 *
 * The LLM rewrites the profile, the result is checked against the profile rules, and you see a
 * list of exactly what would change before anything is saved. Presets in profiles/ are never
 * modified: changing one saves your version as scout.profile.yaml. Your `sources` section is never
 * sent to or changed by the LLM.
 */
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import {
  booleanFlag,
  commandHint,
  findRepoRoot,
  planProfileWrite,
  parseFlags,
  readProfileFile,
  stringFlag,
  swapProfileBackup
} from "../packages/shared/src/index.js";
import { editProfileYaml } from "../packages/intelligence/src/profile-draft.js";
import { displayPath, loadProfileContext, printProfile, saveNewProfileVersion } from "./profile-common.js";

const FLAG_SPEC = { root: "string", yes: "boolean", show: "boolean", undo: "boolean" } as const;

async function main(): Promise<void> {
  const { flags, positionals } = parseFlags(process.argv.slice(2), FLAG_SPEC);
  const rootFlag = stringFlag(flags, "root");
  const root = rootFlag ? resolve(process.cwd(), rootFlag) : findRepoRoot(process.cwd());
  if (!root) {
    throw new Error(
      "Could not find the project folder (no pnpm-workspace.yaml above the current directory). " +
        "Run this from inside the project, or pass --root <dir>."
    );
  }

  if (booleanFlag(flags, "undo")) return undo(root);

  const context = loadProfileContext(root);
  if (!context.selection || context.currentYaml === undefined) {
    throw new Error(
      `Your current preferences could not be loaded:\n  ${context.profileError}\n` +
        `Run \`${commandHint("profile:undo")}\` to go back to the previous version, or \`${commandHint("profile:new")}\` to start over.`
    );
  }

  console.log(`Your preferences (${context.selection.source}):\n`);
  printProfile(context.selection.profile);
  if (booleanFlag(flags, "show")) {
    console.log(`\nTo change them: ${commandHint("profile:edit", "\"what you'd like to change\"")}`);
    return;
  }

  if (!context.env.llm.enabled) {
    throw new Error(
      `\nChanging preferences with a sentence uses your LLM, and none is set up yet (${context.env.llm.disabledReason}).\n` +
        `Run \`${commandHint("onboard")}\` to add one, or edit the profile file by hand (see docs/profiles.md).`
    );
  }

  let instruction = positionals.join(" ").trim();
  if (!instruction) {
    if (!process.stdin.isTTY) {
      throw new Error('Say what to change, e.g. `pnpm profile:edit "add climate tech events"`.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('\nWhat would you like to change? For example: "add climate tech", "no crypto events",');
      instruction = (await rl.question('"only dinners and breakfasts", "show me fewer, better events".\n> ')).trim();
    } finally {
      rl.close();
    }
    if (!instruction) {
      console.log("Nothing entered; your preferences are unchanged.");
      return;
    }
  }

  console.log(`\nAsking ${context.env.llm.provider} (${context.env.llm.models.score}) to update your preferences...`);
  const result = await editProfileYaml({ currentYaml: context.currentYaml, instruction, env: context.env });
  if (!result.changes.length) {
    console.log("The LLM did not change anything. Try saying it differently, or more specifically.");
    return;
  }

  console.log("\nHere is what would change:\n");
  for (const line of result.changes) console.log(`  ${line}`);

  if (!booleanFlag(flags, "yes")) {
    if (!process.stdin.isTTY) {
      throw new Error("Not saved: pass --yes to save without being asked.");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = (await rl.question("\nSave these changes? [Y/n] ")).trim().toLowerCase();
    } finally {
      rl.close();
    }
    if (answer && answer !== "y" && answer !== "yes") {
      console.log("Not saved; your preferences are unchanged.");
      return;
    }
  }

  saveNewProfileVersion(context, result.yaml);
}

function undo(root: string): void {
  const context = loadProfileContext(root);
  // Undo works on the file edits are saved to; when the current profile is broken, that is the
  // repo's own scout.profile.yaml.
  const targetPath = context.selection
    ? planProfileWrite({ root, selection: context.selection, processScoutProfile: process.env.SCOUT_PROFILE }).targetPath
    : resolve(root, "scout.profile.yaml");

  if (!existsSync(`${targetPath}.bak`)) {
    console.log(`There is no earlier version of ${displayPath(root, targetPath)} to go back to.`);
    return;
  }
  swapProfileBackup(targetPath);
  console.log(`Restored the previous version of ${displayPath(root, targetPath)}. (Run ${commandHint("profile:undo")} again to redo.)\n`);
  try {
    printProfile(readProfileFile(targetPath));
  } catch (error) {
    console.log(`  (It does not load cleanly: ${error instanceof Error ? error.message : String(error)})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
