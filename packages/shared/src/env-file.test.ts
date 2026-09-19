import assert from "node:assert/strict";
import test from "node:test";
import { maskSecret, mergeEnvFileContent } from "./env-file.js";

test("maskSecret shows a short prefix and suffix for secrets 16 characters or longer", () => {
  assert.equal(maskSecret("sk-1234567890abcd"), "sk-…abcd");
  assert.equal(maskSecret("0123456789012345"), "012…2345"); // exactly 16
});

test("maskSecret shows even less for secrets under 16 characters", () => {
  assert.equal(maskSecret("short12"), "sh…12");
  assert.equal(maskSecret("012345678901234"), "01…34"); // exactly 15
});

test("maskSecret treats blank and missing values the same way", () => {
  assert.equal(maskSecret(""), "(not set)");
  assert.equal(maskSecret("   "), "(not set)");
  assert.equal(maskSecret(undefined), "(not set)");
});

test("mergeEnvFileContent updates an existing key in place and preserves comments and order", () => {
  const existing = ["# header comment", "MOCK_MODE=true", "", "LLM_PROVIDER=", "EXA_API_KEY=old"].join("\n");
  const result = mergeEnvFileContent(existing, { LLM_PROVIDER: "openai", EXA_API_KEY: "new-key" });

  assert.equal(
    result,
    ["# header comment", "MOCK_MODE=true", "", "LLM_PROVIDER=openai", "EXA_API_KEY=new-key"].join("\n") + "\n"
  );
});

test("mergeEnvFileContent appends unknown keys after a separating blank line", () => {
  const existing = "MOCK_MODE=true";
  const result = mergeEnvFileContent(existing, { TELEGRAM_BOT_TOKEN: "abc" });
  assert.equal(result, "MOCK_MODE=true\n\nTELEGRAM_BOT_TOKEN=abc\n");
});

test("mergeEnvFileContent builds a fresh file with no leading blank line when starting empty", () => {
  const result = mergeEnvFileContent("", { MOCK_MODE: "true", LLM_PROVIDER: "openai" });
  assert.equal(result, "MOCK_MODE=true\nLLM_PROVIDER=openai\n");
});

test("mergeEnvFileContent leaves keys mapped to undefined untouched", () => {
  const existing = "EXA_API_KEY=keep-me\n";
  const result = mergeEnvFileContent(existing, { EXA_API_KEY: undefined, X_BEARER_TOKEN: undefined });
  assert.equal(result, "EXA_API_KEY=keep-me\n");
});

test("mergeEnvFileContent never duplicates a key that already exists further down the file", () => {
  const existing = "FIRST=1\nDUPLICATE=old\nLAST=2";
  const result = mergeEnvFileContent(existing, { DUPLICATE: "new" });
  assert.equal(result, "FIRST=1\nDUPLICATE=new\nLAST=2\n");
});

test("mergeEnvFileContent updates an indented key in place instead of appending a duplicate", () => {
  const existing = ["FIRST=1", "  LLM_PROVIDER=", "LAST=2"].join("\n");
  const result = mergeEnvFileContent(existing, { LLM_PROVIDER: "openai" });
  // Rewritten flush-left: the indentation is not preserved, but the line is updated in place
  // (not duplicated), matching what parseEnvFile (which already trims lines) reads as the key.
  assert.equal(result, "FIRST=1\nLLM_PROVIDER=openai\nLAST=2\n");
  assert.equal((result.match(/LLM_PROVIDER=/g) ?? []).length, 1);
});

test("mergeEnvFileContent accepts tab-indented keys too", () => {
  const existing = "\tEXA_API_KEY=old";
  const result = mergeEnvFileContent(existing, { EXA_API_KEY: "new" });
  assert.equal(result, "EXA_API_KEY=new\n");
});

test("mergeEnvFileContent preserves CRLF line endings when updating an existing key", () => {
  const existing = ["# header", "MOCK_MODE=true", "LLM_PROVIDER="].join("\r\n");
  const result = mergeEnvFileContent(existing, { LLM_PROVIDER: "openai" });
  assert.equal(result, ["# header", "MOCK_MODE=true", "LLM_PROVIDER=openai"].join("\r\n") + "\r\n");
  assert.equal(result.includes("\n") && !result.includes("\r\n"), false); // every LF is part of a CRLF pair
});

test("mergeEnvFileContent preserves CRLF for an appended key, including its blank-line separator", () => {
  const existing = ["# header", "MOCK_MODE=true"].join("\r\n");
  const result = mergeEnvFileContent(existing, { EXA_API_KEY: "new" });
  assert.equal(result, ["# header", "MOCK_MODE=true", "", "EXA_API_KEY=new"].join("\r\n") + "\r\n");
});

test("mergeEnvFileContent uses LF for a file that has no CRLF, even for appended keys", () => {
  const result = mergeEnvFileContent("MOCK_MODE=true\n", { TELEGRAM_BOT_TOKEN: "abc" });
  assert.equal(result, "MOCK_MODE=true\n\nTELEGRAM_BOT_TOKEN=abc\n");
});
