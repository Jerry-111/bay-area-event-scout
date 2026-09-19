import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { mergeEnvFileContent, parseEnvFile } from "./env-file.js";
import { PROFILE_FILE_NAME, PROFILES_DIR_NAME, type ProfileSelection } from "./profile.js";

/**
 * Where `pnpm profile:new` / `pnpm profile:edit` save a profile, and what else has to change for
 * the saved file to be the one scans use. Presets in profiles/ are never modified: editing a preset
 * (or the built-in default) saves a copy as scout.profile.yaml and turns off SCOUT_PROFILE, which
 * would otherwise keep selecting the preset.
 */
export interface ProfileWritePlan {
  /** The file the new YAML is written to. */
  targetPath: string;
  /** SCOUT_PROFILE is set in the repo's own .env.local and has to be cleared for targetPath to take effect. */
  clearScoutProfileInEnvLocal: boolean;
  /**
   * Set when SCOUT_PROFILE comes from somewhere this command must not edit (the shell environment,
   * or an .env.local outside the repo), so the saved file will not take effect until the person
   * removes it themselves. Holds a sentence saying where it is set.
   */
  scoutProfileSetElsewhere?: string;
}

export function planProfileWrite(input: {
  root: string;
  selection: ProfileSelection;
  /** SCOUT_PROFILE from the real process environment, if any. */
  processScoutProfile?: string;
}): ProfileWritePlan {
  const root = resolve(input.root);
  const { selection } = input;
  const rootProfilePath = join(root, PROFILE_FILE_NAME);
  const selectedPath = selection.path ? resolve(selection.path) : undefined;
  const isPresetFile = selectedPath !== undefined && dirname(selectedPath) === join(root, PROFILES_DIR_NAME);

  // A profile file the person chose or created (not a preset, not a parent checkout's file) is
  // edited in place; everything else becomes the repo's own scout.profile.yaml.
  const editInPlace =
    selectedPath !== undefined &&
    !isPresetFile &&
    (selection.selectedBy === "path" || (selection.selectedBy === "file" && isInside(root, selectedPath)));
  const targetPath = editInPlace ? selectedPath : rootProfilePath;

  const scoutProfileSelectsSomethingElse =
    (selection.selectedBy === "preset" || selection.selectedBy === "path") && targetPath !== selectedPath;
  if (!scoutProfileSelectsSomethingElse) return { targetPath, clearScoutProfileInEnvLocal: false };

  if (input.processScoutProfile?.trim()) {
    return {
      targetPath,
      clearScoutProfileInEnvLocal: false,
      scoutProfileSetElsewhere: `SCOUT_PROFILE=${input.processScoutProfile.trim()} is set in your shell environment`
    };
  }
  const envLocalPath = join(root, ".env.local");
  if (existsSync(envLocalPath) && parseEnvFile(readFileSync(envLocalPath, "utf8")).SCOUT_PROFILE?.trim()) {
    return { targetPath, clearScoutProfileInEnvLocal: true };
  }
  return {
    targetPath,
    clearScoutProfileInEnvLocal: false,
    scoutProfileSetElsewhere: "SCOUT_PROFILE is set in an .env.local outside this folder"
  };
}

/**
 * Saves `yaml` according to `plan`, keeping the previous version as `<target>.bak` so the change
 * can be undone. When the target does not exist yet (the person was on a preset or the built-in
 * default), `previousYaml` is what gets backed up, so undoing restores the same preferences.
 * Returns the backup path, or undefined when there was nothing to back up.
 */
export function saveProfileYaml(input: {
  root: string;
  plan: ProfileWritePlan;
  yaml: string;
  previousYaml?: string;
}): string | undefined {
  const { plan } = input;
  let backupPath: string | undefined = `${plan.targetPath}.bak`;
  if (existsSync(plan.targetPath)) copyFileSync(plan.targetPath, backupPath);
  else if (input.previousYaml?.trim()) writeFileSync(backupPath, withTrailingNewline(input.previousYaml), "utf8");
  else backupPath = undefined;
  writeFileSync(plan.targetPath, withTrailingNewline(input.yaml), "utf8");

  if (plan.clearScoutProfileInEnvLocal) {
    const envLocalPath = join(resolve(input.root), ".env.local");
    writeFileSync(envLocalPath, mergeEnvFileContent(readFileSync(envLocalPath, "utf8"), { SCOUT_PROFILE: "" }), "utf8");
  }
  return backupPath;
}

/**
 * Swaps `targetPath` with its `.bak`, so running it twice redoes the change. Returns false (and
 * changes nothing) when there is no backup.
 */
export function swapProfileBackup(targetPath: string): boolean {
  const backupPath = `${targetPath}.bak`;
  if (!existsSync(backupPath)) return false;
  if (!existsSync(targetPath)) {
    renameSync(backupPath, targetPath);
    return true;
  }
  const swapPath = `${targetPath}.swap`;
  renameSync(targetPath, swapPath);
  renameSync(backupPath, targetPath);
  renameSync(swapPath, backupPath);
  return true;
}

function isInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
