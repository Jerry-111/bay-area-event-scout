import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROFILE, describeProfile, describeProfileChanges, parseProfile, type ScoutProfile } from "./index.js";

function withChanges(change: (raw: Record<string, any>) => void): ScoutProfile {
  const raw = structuredClone(DEFAULT_PROFILE) as unknown as Record<string, any>;
  change(raw);
  return parseProfile(raw, "test");
}

test("describeProfile groups topics by direction and states the score bar", () => {
  const lines = describeProfile(DEFAULT_PROFILE);
  assert.match(lines[0], /^Who it's for: /);
  assert.ok(lines.includes("More of:"));
  assert.ok(lines.includes("Less of:"));
  assert.ok(lines.some((line) => line.startsWith("Never shown: ") && line.includes("hackathon")));
  assert.match(lines.at(-1)!, /Recommended at 80\+ out of 100; shown for review at 65\+/);
});

test("describeProfileChanges is empty for equivalent profiles, ignoring order and case", () => {
  assert.deepEqual(describeProfileChanges(DEFAULT_PROFILE, DEFAULT_PROFILE), []);
  const reordered = withChanges((raw) => {
    raw.audience = [...raw.audience].reverse().map((value: string) => value.toUpperCase());
  });
  assert.deepEqual(describeProfileChanges(DEFAULT_PROFILE, reordered), []);
});

test("describeProfileChanges lists topic, list, persona, and threshold changes in plain language", () => {
  const edited = withChanges((raw) => {
    raw.persona = "a climate tech founder";
    raw.topics = raw.topics.filter((topic: { weight: number }) => topic.weight >= 0);
    raw.topics.push({ name: "Climate tech", weight: 8, keywords: ["climate tech", "decarbonization"] });
    raw.topics[0].weight = 2;
    raw.exclude.formats = [...raw.exclude.formats.filter((format: string) => format !== "hackathon"), "panel"];
    raw.thresholds = { recommend: 75, review: 60 };
  });
  const lines = describeProfileChanges(DEFAULT_PROFILE, edited);
  const text = lines.join("\n");

  assert.match(text, /^Who it's for:\n {4}was: .+\n {4}now: a climate tech founder/m);
  assert.match(text, /Topics: added Climate tech \(\+8\): climate tech, decarbonization/);
  assert.match(text, new RegExp(`Topics: changed "${DEFAULT_PROFILE.topics[0].name.replace(/[/()]/g, "\\$&")}": weight \\+\\d+ → \\+2`));
  for (const removed of DEFAULT_PROFILE.topics.filter((topic) => topic.weight < 0)) {
    assert.ok(lines.includes(`Topics: removed "${removed.name}"`), `expected removal of ${removed.name}`);
  }
  assert.ok(lines.includes("Never show these formats: + panel; − hackathon"));
  assert.ok(lines.includes("Recommend at: 80+ → 75+"));
  assert.ok(lines.includes("Show for review at: 65+ → 60+"));
});

test("describeProfileChanges reports keyword additions and removals inside a kept topic", () => {
  const edited = withChanges((raw) => {
    raw.topics[0].keywords = [...raw.topics[0].keywords.slice(1), "brand new keyword"];
  });
  const [line] = describeProfileChanges(DEFAULT_PROFILE, edited);
  assert.match(line, /^Topics: changed ".+": keywords \+ brand new keyword; − .+$/);
});
