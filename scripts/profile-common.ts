/**
 * Shared plumbing for the profile commands (`profile:new`, `profile:edit`, and the onboarding
 * wizard): loading the settings and the active profile without failing when the profile file
 * itself is broken, printing a profile in plain language, and saving a new version.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  commandHint,
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_NAME,
  PROFILES_DIR_NAME,
  describeProfile,
  findUpPath,
  loadEnv,
  loadProfile,
  parseEnvFile,
  planProfileWrite,
  saveProfileYaml,
  type AppEnv,
  type ProfileSelection,
  type ScoutProfile
} from "../packages/shared/src/index.js";

export interface ProfileContext {
  root: string;
  env: AppEnv;
  /** SCOUT_PROFILE as the scans see it (.env.local, overridden by the shell), if set. */
  scoutProfileSetting?: string;
  /** The active profile, or undefined when the file it points to is missing or invalid. */
  selection?: ProfileSelection;
  /** Why the active profile could not be loaded. */
  profileError?: string;
  /** The active profile's YAML text (the preset file for the built-in default). */
  currentYaml?: string;
}

export function loadProfileContext(root: string): ProfileContext {
  const envLocalPath = findUpPath(root, ".env.local");
  const localValues = envLocalPath ? parseEnvFile(readFileSync(envLocalPath, "utf8")) : {};
  const merged = { ...localValues, ...process.env };

  let selection: ProfileSelection | undefined;
  let profileError: string | undefined;
  try {
    selection = loadProfile({ cwd: root, env: merged });
  } catch (error) {
    profileError = error instanceof Error ? error.message : String(error);
  }

  const env = loadEnv(merged, {
    profile: selection?.profile ?? DEFAULT_PROFILE,
    profileSource: selection?.source ?? "unavailable"
  });
  const currentYaml = selection ? readProfileText(root, selection) : undefined;
  const scoutProfileSetting = merged.SCOUT_PROFILE?.trim() || undefined;
  return { root, env, scoutProfileSetting, selection, profileError, currentYaml };
}

function readProfileText(root: string, selection: ProfileSelection): string {
  if (selection.path) return readFileSync(selection.path, "utf8");
  const presetPath = join(root, PROFILES_DIR_NAME, `${DEFAULT_PROFILE_NAME}.yaml`);
  // JSON is valid YAML, and this fallback only matters if the preset file has been deleted.
  return existsSync(presetPath) ? readFileSync(presetPath, "utf8") : `${JSON.stringify(DEFAULT_PROFILE, null, 2)}\n`;
}

export function printProfile(profile: ScoutProfile, indent = "  "): void {
  for (const line of describeProfile(profile)) console.log(`${indent}${line}`);
}

/**
 * Saves a new version of the active profile (backing up the old one) and explains, in plain
 * words, where it went and how to undo it.
 */
export function saveNewProfileVersion(context: ProfileContext, yaml: string): void {
  // When the active profile could not be loaded (a broken file, or SCOUT_PROFILE naming a preset
  // that does not exist), the new version goes to the repo's own scout.profile.yaml and any
  // SCOUT_PROFILE in .env.local is switched off, exactly as if a preset had been selected.
  const selection: ProfileSelection = context.selection ?? {
    profile: DEFAULT_PROFILE,
    source: context.scoutProfileSetting ? `SCOUT_PROFILE=${context.scoutProfileSetting}` : "the previous profile",
    selectedBy: context.scoutProfileSetting ? "preset" : "default"
  };
  const plan = planProfileWrite({ root: context.root, selection, processScoutProfile: process.env.SCOUT_PROFILE });
  const backupPath = saveProfileYaml({ root: context.root, plan, yaml, previousYaml: context.currentYaml });

  console.log(`\nSaved to ${displayPath(context.root, plan.targetPath)}. Your next scan will use these preferences.`);
  if (plan.clearScoutProfileInEnvLocal) {
    console.log(`(Also turned off SCOUT_PROFILE in .env.local, which was selecting ${selection.source} instead of this file.)`);
  }
  if (plan.scoutProfileSetElsewhere) {
    console.log(
      `Heads up: ${plan.scoutProfileSetElsewhere}, so scans keep using ${selection.source} until you remove that setting.`
    );
  }
  if (backupPath) console.log(`Changed your mind? Run: ${commandHint("profile:undo")}`);
}

export function displayPath(root: string, path: string): string {
  const relativePath = relative(root, path);
  return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}
