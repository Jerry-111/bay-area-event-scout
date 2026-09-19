import { dirname } from "node:path";
import { findUpPath } from "./profile.js";

/**
 * Finds the repository root: the nearest directory (starting at `startDir` and walking up)
 * that contains `pnpm-workspace.yaml`. Used by the onboarding wizard and `pnpm doctor` so they
 * only ever read/write `.env.local` at the repo root, never a parent checkout's copy.
 */
export function findRepoRoot(startDir: string = process.cwd()): string | undefined {
  const marker = findUpPath(startDir, "pnpm-workspace.yaml");
  return marker ? dirname(marker) : undefined;
}
