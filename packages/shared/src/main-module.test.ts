import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { isMainModule } from "./index.js";

test("isMainModule matches the entry script even when its folder name has a space", () => {
  const dir = mkdtempSync(join(tmpdir(), "scout main module "));
  const script = join(dir, "run.js");
  writeFileSync(script, "");
  assert.equal(isMainModule(pathToFileURL(script).href, script), true);
  assert.equal(isMainModule(pathToFileURL(script).href, join(dir, "other.js")), false);
  assert.equal(isMainModule(pathToFileURL(script).href, undefined), false);
});
