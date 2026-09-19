/**
 * Pure helpers for the onboarding wizard's `.env.local` handling: masking secrets for display,
 * and merging new values into an existing (or template) env file without disturbing comments,
 * ordering, or keys the wizard does not know about.
 */

/**
 * Masks a secret for terminal display, e.g. "sk-1234567890abcd" -> "sk-…cdef". Never logs the
 * full value. Shorter secrets reveal proportionally less: under 16 characters shows only the
 * first 2 and last 2 characters, so a short test/placeholder value like "short12" does not end
 * up mostly in plain text.
 */
export function maskSecret(value: string | undefined): string {
  if (value === undefined) return "(not set)";
  const trimmed = value.trim();
  if (!trimmed) return "(not set)";
  if (trimmed.length < 16) return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

// Accepts leading whitespace so an indented `  KEY=value` (e.g. hand-edited or copy-pasted with
// indentation) is recognized as the same key `parseEnvFile` (packages/shared/src/index.ts) would
// read, instead of being treated as an unrecognized line and getting a duplicate appended below.
const ENV_KEY_PATTERN = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * Merges `updates` into `existingContent` (the current `.env.local`, or a template such as
 * `.env.example` when the file does not exist yet): existing `KEY=value` lines are updated in
 * place (including an indented `  KEY=value`, which is rewritten flush-left as `KEY=value` rather
 * than duplicated), comments and unrelated lines are preserved verbatim, and keys with no existing
 * line are appended at the end. A key mapped to `undefined` is left untouched (keeps its current
 * value, or stays absent). Line endings match the input: CRLF if `existingContent` used it
 * anywhere, LF otherwise. The result always ends with exactly one trailing newline.
 */
export function mergeEnvFileContent(existingContent: string, updates: Record<string, string | undefined>): string {
  const definedUpdates = new Map<string, string>();
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) definedUpdates.set(key, value);
  }

  const newline = existingContent.includes("\r\n") ? "\r\n" : "\n";
  const normalized = existingContent.replace(/\r\n/g, "\n");
  const lines = normalized.length ? normalized.split("\n") : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const seen = new Set<string>();
  const merged = lines.map((line) => {
    const match = ENV_KEY_PATTERN.exec(line);
    if (!match) return line;
    const key = match[1];
    seen.add(key);
    return definedUpdates.has(key) ? `${key}=${definedUpdates.get(key)}` : line;
  });

  const newKeys = [...definedUpdates.keys()].filter((key) => !seen.has(key));
  if (newKeys.length) {
    if (merged.length && merged[merged.length - 1] !== "") merged.push("");
    for (const key of newKeys) merged.push(`${key}=${definedUpdates.get(key)}`);
  }

  return `${merged.join(newline)}${newline}`;
}

/** Parses `.env`-style content: `KEY=value` lines, `#` comments, optional matching quotes. Later lines win. */
export function parseEnvFile(contents: string): NodeJS.ProcessEnv {
  const parsed: NodeJS.ProcessEnv = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    parsed[key] = unquoteEnvValue(rawValue);
  }

  return parsed;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
