import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findRepoRoot } from "./repo-root.js";

test("findRepoRoot finds the directory containing pnpm-workspace.yaml", () => {
  const root = mkdtempSync(join(tmpdir(), "scout-root-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  const nested = join(root, "apps", "worker", "src");
  mkdirSync(nested, { recursive: true });

  assert.equal(findRepoRoot(nested), root);
  assert.equal(findRepoRoot(root), root);
});

test("findRepoRoot returns undefined when there is no pnpm-workspace.yaml above", () => {
  const isolated = mkdtempSync(join(tmpdir(), "scout-no-root-"));
  assert.equal(findRepoRoot(isolated), undefined);
});
