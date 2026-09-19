import type { ProfileTopic, ScoutProfile } from "./profile.js";

/**
 * Plain-language views of a scout profile for the CLI: a summary of what the scout is looking for
 * (`pnpm profile:edit --show`, the onboarding wizard) and a field-by-field list of what an edit
 * changed (`pnpm profile:edit`), so nobody has to read YAML to know what they are agreeing to.
 */

const MAX_KEYWORDS_SHOWN = 6;

export function describeProfile(profile: ScoutProfile): string[] {
  const lines: string[] = [`Who it's for: ${profile.persona}`];
  lines.push(`Region: ${profile.region.name} (${profile.region.cities.join(", ")})`);

  const boosted = profile.topics.filter((topic) => topic.weight > 0);
  const neutral = profile.topics.filter((topic) => topic.weight === 0);
  const lowered = profile.topics.filter((topic) => topic.weight < 0);
  if (boosted.length) {
    lines.push("More of:");
    for (const topic of boosted) lines.push(`  + ${describeTopic(topic)}`);
  }
  if (neutral.length) {
    lines.push("Relevant, no bonus:");
    for (const topic of neutral) lines.push(`  · ${describeTopic(topic)}`);
  }
  if (lowered.length) {
    lines.push("Less of:");
    for (const topic of lowered) lines.push(`  - ${describeTopic(topic)}`);
  }

  if (profile.audience.length) lines.push(`People to meet: ${profile.audience.join(", ")}`);
  if (profile.formats.prefer.length) lines.push(`Preferred formats: ${profile.formats.prefer.join(", ")}`);
  if (profile.formats.avoid.length) lines.push(`Down-ranked formats: ${profile.formats.avoid.join(", ")}`);

  const never = [
    ...profile.exclude.formats,
    ...profile.exclude.topics,
    ...profile.exclude.eligibility
  ];
  if (never.length) lines.push(`Never shown: ${never.join(", ")}`);
  lines.push(
    `Recommended at ${profile.thresholds.recommend}+ out of 100; shown for review at ${profile.thresholds.review}+`
  );
  return lines;
}

function describeTopic(topic: ProfileTopic): string {
  const shown = topic.keywords.slice(0, MAX_KEYWORDS_SHOWN).join(", ");
  const more = topic.keywords.length > MAX_KEYWORDS_SHOWN ? ", …" : "";
  return `${topic.name} (${formatWeight(topic.weight)}): ${shown}${more}`;
}

function formatWeight(weight: number): string {
  return weight > 0 ? `+${weight}` : String(weight);
}

// Every list-valued field, with the label a person sees for it. Order is the order changes are
// listed in, roughly matching the order of the fields in a profile file.
const LIST_FIELDS: Array<{ label: string; get: (profile: ScoutProfile) => readonly string[] }> = [
  { label: "Cities", get: (profile) => profile.region.cities },
  { label: "Other names for the region", get: (profile) => profile.region.aliases },
  { label: "People to meet", get: (profile) => profile.audience },
  { label: "Preferred formats", get: (profile) => profile.formats.prefer },
  { label: "Down-ranked formats", get: (profile) => profile.formats.avoid },
  { label: "Trusted hosts and venues", get: (profile) => profile.hubs },
  { label: "Never show these formats", get: (profile) => profile.exclude.formats },
  { label: "Never show these topics", get: (profile) => profile.exclude.topics },
  { label: "Never show events that require", get: (profile) => profile.exclude.eligibility },
  { label: "Search phrases", get: (profile) => profile.search.phrases },
  { label: "Room types to search for", get: (profile) => profile.search.rooms },
  { label: "Notes for the scorer", get: (profile) => profile.notes },
  { label: "Turned-off sources", get: (profile) => profile.sources.disable }
];

/**
 * Lists what differs between two profiles, one change per line, in plain language. Returns an
 * empty array when the profiles are equivalent (list order and letter case are ignored).
 */
export function describeProfileChanges(before: ScoutProfile, after: ScoutProfile): string[] {
  const lines: string[] = [];

  if (before.persona !== after.persona) {
    lines.push("Who it's for:");
    lines.push(`    was: ${before.persona}`);
    lines.push(`    now: ${after.persona}`);
  }
  if (before.name !== after.name) lines.push(`Profile name: ${before.name} → ${after.name}`);
  if (before.region.name !== after.region.name) lines.push(`Region: ${before.region.name} → ${after.region.name}`);

  lines.push(...describeTopicChanges(before.topics, after.topics));

  for (const field of LIST_FIELDS) {
    const change = describeListChange(field.get(before), field.get(after));
    if (change) lines.push(`${field.label}: ${change}`);
  }

  const sourcesBefore = before.sources.add.map((source) => source.name);
  const sourcesAfter = after.sources.add.map((source) => source.name);
  const sourceChange = describeListChange(sourcesBefore, sourcesAfter);
  if (sourceChange) lines.push(`Extra sources: ${sourceChange}`);
  else if (JSON.stringify(before.sources.add) !== JSON.stringify(after.sources.add)) {
    lines.push("Extra sources: details changed");
  }

  if (before.thresholds.recommend !== after.thresholds.recommend) {
    lines.push(`Recommend at: ${before.thresholds.recommend}+ → ${after.thresholds.recommend}+`);
  }
  if (before.thresholds.review !== after.thresholds.review) {
    lines.push(`Show for review at: ${before.thresholds.review}+ → ${after.thresholds.review}+`);
  }

  return lines;
}

function describeTopicChanges(before: readonly ProfileTopic[], after: readonly ProfileTopic[]): string[] {
  const lines: string[] = [];
  const beforeByName = new Map(before.map((topic) => [normalize(topic.name), topic]));
  const afterByName = new Map(after.map((topic) => [normalize(topic.name), topic]));

  for (const topic of after) {
    const previous = beforeByName.get(normalize(topic.name));
    if (!previous) {
      lines.push(`Topics: added ${describeTopic(topic)}`);
      continue;
    }
    const parts: string[] = [];
    if (previous.weight !== topic.weight) parts.push(`weight ${formatWeight(previous.weight)} → ${formatWeight(topic.weight)}`);
    const keywordChange = describeListChange(previous.keywords, topic.keywords);
    if (keywordChange) parts.push(`keywords ${keywordChange}`);
    if (parts.length) lines.push(`Topics: changed "${topic.name}": ${parts.join("; ")}`);
  }
  for (const topic of before) {
    if (!afterByName.has(normalize(topic.name))) lines.push(`Topics: removed "${topic.name}"`);
  }
  return lines;
}

/** "+ a, b; − c" for a set difference, or undefined when the lists hold the same entries. */
function describeListChange(before: readonly string[], after: readonly string[]): string | undefined {
  const beforeKeys = new Set(before.map(normalize));
  const afterKeys = new Set(after.map(normalize));
  const added = unique(after.filter((value) => !beforeKeys.has(normalize(value))));
  const removed = unique(before.filter((value) => !afterKeys.has(normalize(value))));
  if (!added.length && !removed.length) return undefined;
  const parts: string[] = [];
  if (added.length) parts.push(`+ ${added.join(", ")}`);
  if (removed.length) parts.push(`− ${removed.join(", ")}`);
  return parts.join("; ");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
