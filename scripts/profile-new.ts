/**
 * Writes new preferences (a scout profile) from a plain-English description, using your configured LLM.
 *
 *   pnpm profile:new
 *   pnpm profile:new "I run partnerships at a B2B SaaS startup; small dinners with founders and buyers; no crypto"
 *   pnpm profile:new --yes "..."          # scripting: save without asking
 *   pnpm profile:new --root <dir> "..."   # use a different project folder (tests)
 *
 * Needs LLM_PROVIDER + a key already configured (run `pnpm onboard` first if not). The previous
 * preferences are kept for `pnpm profile:undo`; to adjust rather than replace them, use
 * `pnpm profile:edit`. The same drafting logic backs the onboarding wizard's "describe yourself"
 * option (packages/intelligence/src/profile-draft.ts).
 */
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { booleanFlag, commandHint, findRepoRoot, parseFlags, stringFlag } from "../packages/shared/src/index.js";
import { draftProfileYaml } from "../packages/intelligence/src/profile-draft.js";
import { loadProfileContext, printProfile, saveNewProfileVersion } from "./profile-common.js";

const FLAG_SPEC = { description: "string", root: "string", yes: "boolean" } as const;

async function main(): Promise<void> {
  const { flags, positionals } = parseFlags(process.argv.slice(2), FLAG_SPEC);
  const nonInteractive = booleanFlag(flags, "yes");
  const rootFlag = stringFlag(flags, "root");

  const root = rootFlag ? resolve(process.cwd(), rootFlag) : findRepoRoot(process.cwd());
  if (!root) {
    throw new Error(
      "Could not find the project folder (no pnpm-workspace.yaml above the current directory). " +
        "Run this from inside the project, or pass --root <dir>."
    );
  }

  const context = loadProfileContext(root);
  const { env } = context;
  if (!env.llm.enabled) {
    throw new Error(
      `Writing preferences from a description uses your LLM, and none is set up yet (${env.llm.disabledReason}).\n` +
        `Run \`${commandHint("onboard")}\` to add one, or start from a preset: see docs/profiles.md.`
    );
  }

  let description = stringFlag(flags, "description") ?? positionals.join(" ").trim();
  if (!description) {
    if (!process.stdin.isTTY) {
      throw new Error('Describe who the scout works for, e.g. `pnpm profile:new "a seed-stage climate tech founder..."`.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('Describe yourself: what you do, which events you want, and what to skip. Any language is fine.');
      console.log('For example: "I run partnerships at a B2B SaaS startup and want small dinners with founders and');
      description = (await rl.question('enterprise buyers; climate tech is interesting too; no crypto".\n> ')).trim();
    } finally {
      rl.close();
    }
    if (!description) throw new Error("Nothing entered; aborting.");
  }

  console.log(`\nAsking ${env.llm.provider} (${env.llm.models.score}) to write your preferences...`);
  const draft = await draftProfileYaml(description, env);

  console.log("\nHere is what the scout would look for:\n");
  printProfile(draft.profile);
  if (draft.sourcesWereStripped) {
    console.log(
      "\n  Note: the draft included a `sources` key; it was ignored (an LLM cannot know your real " +
        "calendar/feed/X URLs). Add sources by hand under `sources:` in the profile file if you want them."
    );
  }

  if (!nonInteractive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = (await rl.question("\nUse these preferences? [Y/n] ")).trim().toLowerCase();
    } finally {
      rl.close();
    }
    if (answer && answer !== "y" && answer !== "yes") {
      console.log(`Discarded; your preferences are unchanged. (Small tweaks are easier with \`${commandHint("profile:edit")}\`.)`);
      return;
    }
  }

  saveNewProfileVersion(context, draft.yaml);
  console.log(`Fine-tune later with: ${commandHint("profile:edit", "\"what to change\"")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
