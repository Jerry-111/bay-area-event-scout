import { DEFAULT_PROFILE, describeProfileChanges, parseProfile, type AppEnv, type ScoutProfile } from "@event-scout/shared";
import { isMap, parse as parseYaml, parseDocument, stringify as stringifyYaml, type Node as YamlNode } from "yaml";
import { callLlm } from "./llm-client.js";

/**
 * Writes and rewrites scout profiles with the configured LLM:
 * - draftProfileYaml: a new profile from a plain-English description (`pnpm profile:new`, and the
 *   onboarding wizard's "describe yourself" option).
 * - editProfileYaml: applies a plain-English change to an existing profile (`pnpm profile:edit`,
 *   and the wizard's "change my current preferences" option).
 * Both validate the model's YAML against the profile schema and retry once with the errors.
 */

export interface DraftProfileResult {
  /** The YAML text that was validated. Safe to write straight to `scout.profile.yaml`. */
  yaml: string;
  /** The same document, parsed and validated against the profile schema. */
  profile: ScoutProfile;
  /**
   * True when the LLM ignored the instruction not to draft a `sources` key. It was removed before
   * validation (a fresh LLM draft cannot know real calendar/feed/X URLs, so a drafted one would be
   * fabricated and would make real scans fetch arbitrary URLs) and `yaml` reflects the removal.
   * Callers should tell the user sources were ignored; they can still add sources by hand.
   */
  sourcesWereStripped: boolean;
}

// DEFAULT_PROFILE is kept identical to profiles/consumer-ai-founder.yaml (enforced by a shared
// package test), so re-serializing it gives the model a real, currently-valid example without
// this package having to read a file outside its own source tree.
const EXAMPLE_PROFILE_YAML = stringifyYaml(DEFAULT_PROFILE).trim();

const PROFILE_SCHEMA_REFERENCE = `
Fields (unknown keys are rejected, so use only these):
- name: string, optional, short kebab-case slug. Defaults to "custom".
- persona: string, REQUIRED. Third person, specific, goes straight into LLM prompts.
- region: optional object { name: string, cities: string[], aliases: string[] }. Defaults to SF Bay Area.
- topics: optional array of { name: string, weight: number (-50..50, 0 default), keywords: string[] (at least one) }.
  Positive weight boosts a matching event's score, negative penalizes it, 0 marks it relevant with no automatic adjustment.
- audience: optional string[] of the people they want in the room (e.g. founder, investor, operator).
- formats: optional object { prefer: string[], avoid: string[] } of event formats.
- hubs: optional string[] of venues/communities whose events usually have a strong room.
- exclude: optional object { formats: string[], topics: string[], eligibility: string[] } — hard filters,
  dropped before any LLM call. eligibility is for gates the person likely cannot pass (e.g. "phd required").
- search: object { phrases: string[] (REQUIRED, at least one; how people phrase the events wanted),
  rooms: string[] (optional; room/format phrases used in search queries) }.
- notes: optional string[] of extra guidance passed to the LLM scorer word for word.
- thresholds: optional object { recommend: integer 1-100 (default 80), review: integer 0-100 (default 65) }.
  review must be lower than recommend.
Do not include a "sources" key: it takes real calendar/feed/X URLs the model cannot know, and is left
for the person to add by hand later.
Write every value in English, even when the person writes in another language: event pages and
keyword matching are in English.
`.trim();

export async function draftProfileYaml(description: string, env: AppEnv): Promise<DraftProfileResult> {
  const trimmedDescription = description.trim();
  if (!trimmedDescription) {
    throw new Error("Describe the person this scout works for (persona, interests, region) before drafting a profile.");
  }
  // Deliberately checks env.llm.enabled directly, not the intelligence pipeline's llmEnabled()
  // (which also requires MOCK_MODE=false): drafting a profile is a CLI/wizard action that should
  // work as soon as an LLM is configured, whether or not the user has flipped to real mode yet.
  if (!env.llm.enabled) {
    throw new Error(`Drafting a profile needs a configured LLM: ${env.llm.disabledReason ?? "LLM_PROVIDER is not set"}`);
  }

  const firstAttempt = await requestProfileYaml(buildDraftPrompt(trimmedDescription), env);
  const firstResult = tryParseProfileYaml(firstAttempt);
  if (firstResult.ok) return finalizeDraft(firstAttempt, firstResult);

  const secondAttempt = await requestProfileYaml(
    buildRepairPrompt(trimmedDescription, firstAttempt, firstResult.error),
    env
  );
  const secondResult = tryParseProfileYaml(secondAttempt);
  if (secondResult.ok) return finalizeDraft(secondAttempt, secondResult);

  throw new Error(
    `Could not draft a valid profile after one retry.\n` +
      `First attempt error: ${firstResult.error}\n` +
      `Second attempt error: ${secondResult.error}`
  );
}

/**
 * Builds the final result from a successful parse. When a `sources` key was stripped, `yaml` is
 * re-serialized from the validated (sources-free) profile instead of the LLM's raw text, so the
 * text callers write to disk can never carry the removed key back in.
 */
function finalizeDraft(rawYaml: string, result: Extract<ParseAttempt, { ok: true }>): DraftProfileResult {
  const yaml = result.sourcesWereStripped ? `${stringifyYaml(result.profile).trim()}\n` : rawYaml;
  return { yaml, profile: result.profile, sourcesWereStripped: result.sourcesWereStripped };
}

// Profile authoring is a one-off call whose output steers every future scan, so it uses the
// stronger scoring model rather than the fast one.
async function requestProfileYaml(prompt: string, env: AppEnv): Promise<string> {
  const raw = await callLlm({ env, model: env.llm.models.score, prompt });
  return stripCodeFences(raw);
}

type ParseAttempt =
  | { ok: true; profile: ScoutProfile; sourcesWereStripped: boolean }
  | { ok: false; error: string };

function tryParseProfileYaml(yamlText: string): ParseAttempt {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    return { ok: false, error: `Could not parse YAML: ${error instanceof Error ? error.message : String(error)}` };
  }

  const { value, sourcesWereStripped } = stripSourcesKey(parsed);

  try {
    return { ok: true, profile: parseProfile(value, "drafted profile"), sourcesWereStripped };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Removes a top-level `sources` key from a drafted (not yet validated) profile document, if
 * present. The prompt tells the model never to draft one, but nothing enforces that on the model
 * side, and `sources` entries turn into real fetches in a live scan.
 */
function stripSourcesKey(value: unknown): { value: unknown; sourcesWereStripped: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("sources" in value)) {
    return { value, sourcesWereStripped: false };
  }
  const { sources: _sources, ...rest } = value as Record<string, unknown>;
  return { value: rest, sourcesWereStripped: true };
}

/**
 * Extracts the first fenced code block found anywhere in the reply (models often add a sentence
 * before or after the YAML despite being asked not to). Falls back to the raw text when there is
 * no fenced block at all.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /```[a-zA-Z]*\n([\s\S]*?)\n?```/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

function buildDraftPrompt(description: string): string {
  return [
    "You are drafting a scout profile YAML file for a small SF Bay Area founder/operator event-discovery tool.",
    "The profile is validated against a strict schema: unknown keys are rejected, so only use the fields listed below.",
    PROFILE_SCHEMA_REFERENCE,
    "Example of a complete, valid profile for a different persona (copy its shape and style, not its content):",
    "```yaml",
    EXAMPLE_PROFILE_YAML,
    "```",
    `Person to draft the profile for, in their own words: ${JSON.stringify(description)}`,
    "Write a new profile YAML for this person. Requirements:",
    "- Only persona and search.phrases are required; omit anything else to take its neutral default.",
    "- persona must be third person and specific to what they described.",
    "- Include 2-6 topics with realistic keywords and weights (positive boosts, negative penalties, 0 for relevant-but-neutral).",
    "- Keep name short, lowercase, kebab-case, based on the persona.",
    "- Return ONLY the YAML document: no Markdown code fences, no commentary before or after."
  ].join("\n\n");
}

function buildRepairPrompt(description: string, previousYaml: string, error: string): string {
  return [
    "The scout profile YAML you produced failed validation. Fix it and return the corrected document.",
    PROFILE_SCHEMA_REFERENCE,
    `Person to draft the profile for: ${JSON.stringify(description)}`,
    "Your previous YAML:",
    "```yaml",
    previousYaml.trim(),
    "```",
    `Validation errors:\n${error}`,
    "Return ONLY the corrected YAML document: no Markdown code fences, no commentary."
  ].join("\n\n");
}

export interface EditProfileResult {
  /** The updated YAML text, validated. `sources` is carried over from the original unchanged. */
  yaml: string;
  /** The updated profile, parsed and validated. */
  profile: ScoutProfile;
  /** What changed, in plain language (see describeProfileChanges). Empty when nothing changed. */
  changes: string[];
}

/**
 * Applies a plain-English change ("add climate tech", "never show crypto events") to an existing
 * profile. The model sees the profile without its `sources` section and never gets to change it:
 * sources are real URLs, so any `sources` key in the reply is dropped and the original section is
 * put back as it was.
 */
export async function editProfileYaml(input: { currentYaml: string; instruction: string; env: AppEnv }): Promise<EditProfileResult> {
  const { env } = input;
  const instruction = input.instruction.trim();
  if (!instruction) {
    throw new Error('Say what you would like to change, e.g. "add climate tech" or "never show crypto events".');
  }
  if (!env.llm.enabled) {
    throw new Error(`Changing preferences with a sentence needs a configured LLM: ${env.llm.disabledReason ?? "LLM_PROVIDER is not set"}`);
  }

  const currentDocument = parseDocument(input.currentYaml);
  if (currentDocument.errors.length) {
    throw new Error(`The current profile is not valid YAML: ${currentDocument.errors[0]?.message}`);
  }
  const currentProfile = parseProfile(currentDocument.toJS(), "the current profile");
  const originalSources = currentDocument.get("sources", true) as YamlNode | undefined;
  const editable = currentDocument.clone();
  editable.delete("sources");
  const editableYaml = editable.toString().trim();

  const firstAttempt = await requestProfileYaml(buildEditPrompt(editableYaml, instruction), env);
  const firstResult = tryParseEditedYaml(firstAttempt, originalSources);
  if (firstResult.ok) return { ...firstResult, changes: describeProfileChanges(currentProfile, firstResult.profile) };

  const secondAttempt = await requestProfileYaml(
    buildEditRepairPrompt(editableYaml, instruction, firstAttempt, firstResult.error),
    env
  );
  const secondResult = tryParseEditedYaml(secondAttempt, originalSources);
  if (secondResult.ok) return { ...secondResult, changes: describeProfileChanges(currentProfile, secondResult.profile) };

  throw new Error(
    `Could not produce a valid updated profile after one retry.\n` +
      `First attempt error: ${firstResult.error}\n` +
      `Second attempt error: ${secondResult.error}`
  );
}

type EditAttempt = { ok: true; yaml: string; profile: ScoutProfile } | { ok: false; error: string };

function tryParseEditedYaml(yamlText: string, originalSources: YamlNode | undefined): EditAttempt {
  const document = parseDocument(yamlText);
  if (document.errors.length) return { ok: false, error: `Could not parse YAML: ${document.errors[0]?.message}` };
  if (!isMap(document.contents)) return { ok: false, error: "The reply was not a YAML mapping of profile fields." };

  document.delete("sources");
  if (originalSources !== undefined) document.set("sources", originalSources);

  try {
    const profile = parseProfile(document.toJS(), "updated profile");
    // Keep the house style of the presets: `[a, b]` lists and long lines left unwrapped.
    return { ok: true, yaml: document.toString({ flowCollectionPadding: false, lineWidth: 0 }), profile };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildEditPrompt(currentYaml: string, instruction: string): string {
  return [
    "You are editing the scout profile YAML of a small SF Bay Area founder/operator event-discovery tool.",
    "The profile decides which events are searched for, which are dropped before scoring, and how the rest are scored.",
    "It is validated against a strict schema: unknown keys are rejected, so only use the fields listed below.",
    PROFILE_SCHEMA_REFERENCE,
    "Current profile:",
    "```yaml",
    currentYaml,
    "```",
    `Requested change, in the person's own words: ${JSON.stringify(instruction)}`,
    "Apply the requested change and return the complete updated profile. Rules:",
    "- Change only what the request asks for, plus whatever must change with it for the profile to stay consistent " +
      "(for example, update the persona and search phrases when the person's focus changes). Keep every other field, " +
      "list entry, and comment exactly as it is.",
    '- "More of X" or "I care about X": add or boost a topic with realistic keywords. "Less of X": give the topic a ' +
      'negative weight. "Never show X": add it to exclude.topics or exclude.formats, which drop events before scoring.',
    "- A stricter or looser bar means changing thresholds (recommend must stay above review).",
    "- If the request has nothing to do with which events to find, return the profile unchanged.",
    "- Return ONLY the YAML document: no Markdown code fences, no commentary before or after."
  ].join("\n\n");
}

function buildEditRepairPrompt(currentYaml: string, instruction: string, previousYaml: string, error: string): string {
  return [
    "The updated scout profile YAML you produced failed validation. Fix it and return the corrected document.",
    PROFILE_SCHEMA_REFERENCE,
    "The profile before the change:",
    "```yaml",
    currentYaml,
    "```",
    `Requested change: ${JSON.stringify(instruction)}`,
    "Your previous YAML:",
    "```yaml",
    previousYaml.trim(),
    "```",
    `Validation errors:\n${error}`,
    "Return ONLY the corrected YAML document: no Markdown code fences, no commentary."
  ].join("\n\n");
}
