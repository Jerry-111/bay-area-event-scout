import assert from "node:assert/strict";
import test from "node:test";
import { booleanFlag, CliFlagError, commandHint, parseFlags, stringFlag } from "./cli-flags.js";

const SPEC = { provider: "string", "api-key-env": "string", yes: "boolean", root: "string" } as const;

test("parseFlags reads space-separated and =-joined values", () => {
  const { flags, positionals } = parseFlags(
    ["--provider", "openai", "--api-key-env=OPENAI_API_KEY", "--yes", "extra"],
    SPEC
  );
  assert.equal(flags.provider, "openai");
  assert.equal(flags["api-key-env"], "OPENAI_API_KEY");
  assert.equal(flags.yes, true);
  assert.deepEqual(positionals, ["extra"]);
});

test("parseFlags treats everything after a bare -- as positional", () => {
  const { positionals } = parseFlags(["--yes", "--", "--provider", "not-a-flag"], SPEC);
  assert.deepEqual(positionals, ["--provider", "not-a-flag"]);
});

test("parseFlags rejects an unknown flag", () => {
  assert.throws(() => parseFlags(["--nope"], SPEC), CliFlagError);
  assert.throws(() => parseFlags(["--nope"], SPEC), /Unknown flag --nope/);
});

test("parseFlags rejects a value on a boolean flag", () => {
  assert.throws(() => parseFlags(["--yes=true"], SPEC), /does not take a value/);
});

test("parseFlags rejects a string flag with no value", () => {
  assert.throws(() => parseFlags(["--provider"], SPEC), /requires a value/);
});

test("stringFlag and booleanFlag read out parsed values with the right type", () => {
  const { flags } = parseFlags(["--provider", "anthropic", "--yes"], SPEC);
  assert.equal(stringFlag(flags, "provider"), "anthropic");
  assert.equal(stringFlag(flags, "root"), undefined);
  assert.equal(booleanFlag(flags, "yes"), true);
  assert.equal(booleanFlag(flags, "provider"), false);
});

test("commandHint suggests pnpm scripts, or npm start actions for people who came in through npm start", () => {
  assert.equal(commandHint("onboard", undefined, {}), "pnpm onboard");
  assert.equal(commandHint("profile:edit", '"add climate tech"', {}), 'pnpm profile:edit "add climate tech"');
  assert.equal(commandHint("onboard", undefined, { SCOUT_LAUNCHER: "npm-start" }), "npm start setup");
  assert.equal(commandHint("profile:undo", undefined, { SCOUT_LAUNCHER: "npm-start" }), "npm start undo");
  assert.equal(commandHint("scout:mock", undefined, { SCOUT_LAUNCHER: "npm-start" }), "pnpm scout:mock");
});
