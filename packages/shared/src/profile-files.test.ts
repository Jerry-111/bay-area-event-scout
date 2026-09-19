import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProfile, planProfileWrite, saveProfileYaml, swapProfileBackup } from "./index.js";

const PRESET_YAML = "name: fintech\npersona: a fintech founder\nsearch:\n  phrases: [fintech founders]\n";
const CUSTOM_YAML = "persona: a climate founder\nsearch:\n  phrases: [climate founders]\n";
const EDITED_YAML = "persona: a climate and energy founder\nsearch:\n  phrases: [climate founders]\n";

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "scout-profile-files-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  mkdirSync(join(root, "profiles"));
  writeFileSync(join(root, "profiles", "fintech.yaml"), PRESET_YAML);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  return root;
}

test("editing a preset saves scout.profile.yaml, backs up the preset, and turns off SCOUT_PROFILE", () => {
  const root = makeRepo({ ".env.local": "# keys\nLLM_PROVIDER=openai\nSCOUT_PROFILE=fintech\n" });
  const selection = loadProfile({ cwd: root, env: { SCOUT_PROFILE: "fintech" } });
  assert.equal(selection.selectedBy, "preset");

  const plan = planProfileWrite({ root, selection });
  assert.equal(plan.targetPath, join(root, "scout.profile.yaml"));
  assert.equal(plan.clearScoutProfileInEnvLocal, true);

  const backupPath = saveProfileYaml({ root, plan, yaml: EDITED_YAML, previousYaml: PRESET_YAML });
  assert.equal(readFileSync(join(root, "scout.profile.yaml"), "utf8"), EDITED_YAML);
  assert.equal(readFileSync(backupPath!, "utf8"), PRESET_YAML);
  assert.equal(readFileSync(join(root, "profiles", "fintech.yaml"), "utf8"), PRESET_YAML, "presets are never modified");
  assert.equal(readFileSync(join(root, ".env.local"), "utf8"), "# keys\nLLM_PROVIDER=openai\nSCOUT_PROFILE=\n");

  // With SCOUT_PROFILE cleared, the saved file is what loads next time.
  assert.equal(loadProfile({ cwd: root, env: { SCOUT_PROFILE: "" } }).profile.persona, "a climate and energy founder");
});

test("an existing scout.profile.yaml is edited in place and the old version kept as .bak", () => {
  const root = makeRepo({ "scout.profile.yaml": CUSTOM_YAML });
  const selection = loadProfile({ cwd: root, env: {} });
  const plan = planProfileWrite({ root, selection });
  assert.deepEqual(plan, { targetPath: join(root, "scout.profile.yaml"), clearScoutProfileInEnvLocal: false });

  saveProfileYaml({ root, plan, yaml: EDITED_YAML, previousYaml: CUSTOM_YAML });
  assert.equal(readFileSync(join(root, "scout.profile.yaml.bak"), "utf8"), CUSTOM_YAML);
});

test("a custom SCOUT_PROFILE path is edited in place and left selected", () => {
  const root = makeRepo({ "mine.yaml": CUSTOM_YAML, ".env.local": "SCOUT_PROFILE=mine.yaml\n" });
  const selection = loadProfile({ cwd: root, env: { SCOUT_PROFILE: "mine.yaml" } });
  assert.equal(selection.selectedBy, "path");
  const plan = planProfileWrite({ root, selection });
  assert.deepEqual(plan, { targetPath: join(root, "mine.yaml"), clearScoutProfileInEnvLocal: false });
});

test("the built-in default becomes scout.profile.yaml without touching .env.local", () => {
  const root = makeRepo({});
  const plan = planProfileWrite({ root, selection: loadProfile({ cwd: root, env: {} }) });
  assert.deepEqual(plan, { targetPath: join(root, "scout.profile.yaml"), clearScoutProfileInEnvLocal: false });
});

test("SCOUT_PROFILE set in the shell is reported, not edited", () => {
  const root = makeRepo({});
  const selection = loadProfile({ cwd: root, env: { SCOUT_PROFILE: "fintech" } });
  const plan = planProfileWrite({ root, selection, processScoutProfile: "fintech" });
  assert.equal(plan.clearScoutProfileInEnvLocal, false);
  assert.match(plan.scoutProfileSetElsewhere ?? "", /shell environment/);
});

test("swapProfileBackup undoes a change, and running it again redoes it", () => {
  const root = makeRepo({ "scout.profile.yaml": EDITED_YAML, "scout.profile.yaml.bak": CUSTOM_YAML });
  const target = join(root, "scout.profile.yaml");
  assert.equal(swapProfileBackup(target), true);
  assert.equal(readFileSync(target, "utf8"), CUSTOM_YAML);
  assert.equal(swapProfileBackup(target), true);
  assert.equal(readFileSync(target, "utf8"), EDITED_YAML);
  assert.equal(existsSync(`${target}.swap`), false);
  assert.equal(swapProfileBackup(join(root, "nothing.yaml")), false);
});
