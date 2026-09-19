import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * A scout profile describes who the scout works for and which events are worth their time.
 * It drives search queries, candidate filtering, the LLM scoring prompt, the deterministic
 * score adjustments, and the recommendation thresholds. See profiles/*.yaml for presets.
 */

export const PROFILE_FILE_NAME = "scout.profile.yaml";
export const PROFILES_DIR_NAME = "profiles";
export const DEFAULT_PROFILE_NAME = "consumer-ai-founder";

const DEFAULT_BAY_AREA_CITIES = ["San Francisco", "Palo Alto", "Menlo Park", "Mountain View", "Berkeley", "Oakland"];
const DEFAULT_ROOMS = ["founder dinner", "founder breakfast", "operator roundtable", "founder salon", "happy hour"];

// Size caps below are generous enough that no human-written profile would hit them; they exist to
// keep a malformed or (for the LLM-drafted path) runaway profile from producing pathological
// prompts or scan behavior. Kept well clear of every preset in profiles/ (checked by a test).
const MAX_LIST_LENGTH = 200;
const MAX_NOTES = 50;
const MAX_TOPICS = 50;
const MAX_KEYWORDS_PER_TOPIC = 100;
const MAX_PERSONA_LENGTH = 1000;

const termList = z.array(z.string().trim().min(1)).max(MAX_LIST_LENGTH, `list at most ${MAX_LIST_LENGTH} entries`).default([]);

const topicSchema = z.strictObject({
  name: z.string().trim().min(1),
  weight: z.number().min(-50).max(50).default(0),
  keywords: z
    .array(z.string().trim().min(1))
    .min(1, "list at least one keyword")
    .max(MAX_KEYWORDS_PER_TOPIC, `list at most ${MAX_KEYWORDS_PER_TOPIC} keywords per topic`)
});

export const PROFILE_SOURCE_KINDS = [
  "luma_calendar",
  "rss_feed",
  "event_digest",
  "organizer_site",
  "indexed_source",
  "x_account"
] as const;

const profileSourceSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    kind: z.enum(PROFILE_SOURCE_KINDS),
    url: z.string().url().optional(),
    feed: z.string().url().optional(),
    handle: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1).optional(),
    priority: z.enum(["must_scan", "high", "medium"]).default("high")
  })
  .superRefine((source, context) => {
    if (source.kind === "rss_feed" && !source.feed) {
      context.addIssue({ code: "custom", message: "rss_feed sources need a feed URL", path: ["feed"] });
    }
    if (source.kind === "x_account" && !source.handle && !source.query) {
      context.addIssue({ code: "custom", message: "x_account sources need a handle or a query", path: ["handle"] });
    }
    if (source.kind === "indexed_source" && !source.query) {
      context.addIssue({ code: "custom", message: "indexed_source sources need a search query", path: ["query"] });
    }
    if (["luma_calendar", "event_digest", "organizer_site"].includes(source.kind) && !source.url) {
      context.addIssue({ code: "custom", message: `${source.kind} sources need a url`, path: ["url"] });
    }
  });

export const scoutProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).default("custom"),
    persona: z.string().trim().min(1).max(MAX_PERSONA_LENGTH, `persona must be ${MAX_PERSONA_LENGTH} characters or fewer`),
    region: z
      .strictObject({
        name: z.string().trim().min(1).default("SF Bay Area"),
        cities: z.array(z.string().trim().min(1)).min(1).default(DEFAULT_BAY_AREA_CITIES),
        aliases: termList
      })
      .prefault({}),
    topics: z.array(topicSchema).max(MAX_TOPICS, `list at most ${MAX_TOPICS} topics`).default([]),
    audience: termList,
    formats: z.strictObject({ prefer: termList, avoid: termList }).prefault({}),
    hubs: termList,
    exclude: z.strictObject({ formats: termList, topics: termList, eligibility: termList }).prefault({}),
    search: z.strictObject({
      phrases: z
        .array(z.string().trim().min(1))
        .min(1, "add at least one phrase describing the events you want")
        .max(MAX_LIST_LENGTH, `list at most ${MAX_LIST_LENGTH} search phrases`),
      rooms: z
        .array(z.string().trim().min(1))
        .max(MAX_LIST_LENGTH, `list at most ${MAX_LIST_LENGTH} search room phrases`)
        .default(DEFAULT_ROOMS)
    }),
    notes: z.array(z.string().trim().min(1)).max(MAX_NOTES, `list at most ${MAX_NOTES} notes`).default([]),
    thresholds: z
      .strictObject({
        recommend: z.number().int().min(1).max(100).default(80),
        review: z.number().int().min(0).max(100).default(65)
      })
      .prefault({})
      .refine((thresholds) => thresholds.review < thresholds.recommend, {
        message: "thresholds.review must be lower than thresholds.recommend"
      }),
    sources: z
      .strictObject({
        disable: termList,
        add: z.array(profileSourceSchema).default([])
      })
      .prefault({})
  });

export type ScoutProfile = z.output<typeof scoutProfileSchema>;
export type ProfileTopic = ScoutProfile["topics"][number];
export type ProfileSource = ScoutProfile["sources"]["add"][number];

export interface ProfileSelection {
  profile: ScoutProfile;
  /** Short label for where the profile came from, e.g. "profiles/fintech.yaml". Safe to log and display. */
  source: string;
  /**
   * How the profile was chosen: a preset name in SCOUT_PROFILE, a path in SCOUT_PROFILE, a
   * scout.profile.yaml found in or above the working directory, or the built-in default.
   */
  selectedBy: "preset" | "path" | "file" | "default";
  /** Absolute path of the YAML file the profile was read from. Undefined for the built-in default. */
  path?: string;
}

/**
 * Built-in default: an early-stage consumer AI founder in the SF Bay Area.
 * Kept identical to profiles/consumer-ai-founder.yaml (enforced by a test).
 */
export const DEFAULT_PROFILE: ScoutProfile = parseProfile(
  {
    name: DEFAULT_PROFILE_NAME,
    persona:
      "an early-stage (pre-seed) founder building consumer AI products who wants small, high-signal in-person rooms with other founders, builders, operators, and early-stage investors",
    region: {
      name: "SF Bay Area",
      cities: DEFAULT_BAY_AREA_CITIES,
      aliases: ["SF", "Bay Area", "San Jose", "Stanford", "SoMa", "Hayes Valley", "Mission"]
    },
    topics: [
      {
        name: "Consumer AI / B2C",
        weight: 8,
        keywords: [
          "b2c",
          "consumer",
          "consumer ai",
          "consumer-facing",
          "prosumer",
          "creator",
          "social app",
          "social product",
          "marketplace",
          "mobile app",
          "personal ai"
        ]
      },
      {
        name: "AI agents",
        weight: 0,
        keywords: ["ai agent", "agent builder", "agent founder", "agentic", "agents"]
      },
      {
        name: "Product, growth and go-to-market",
        weight: 0,
        keywords: ["product", "go-to-market", "gtm", "growth", "design partner"]
      },
      {
        name: "B2B / enterprise SaaS",
        weight: -10,
        keywords: ["b2b", "enterprise", "saas", "procurement", "cio", "ciso", "cxo", "enterprise buyer"]
      },
      {
        name: "Sales and revenue operations",
        weight: -10,
        keywords: [
          "sales",
          "revops",
          "revenue operations",
          "revenue leader",
          "demand gen",
          "lead gen",
          "pipeline",
          "sales leader",
          "marketing leader",
          "customer acquisition"
        ]
      }
    ],
    audience: ["founder", "builder", "operator", "investor", "angel investor", "product leader"],
    formats: {
      prefer: ["dinner", "breakfast", "salon", "roundtable", "founder house"],
      avoid: ["conference", "expo", "online", "class", "course", "training"]
    },
    hubs: [
      "SHACK15",
      "SHACK 15",
      "StartupHQ",
      "Startup HQ",
      "90 Gold",
      "Founders Cafe",
      "Founders Inc",
      "South Park Commons",
      "Cerebral Valley",
      "Frontier Tower",
      "Entrepreneur First",
      "Entrepreneurs First",
      "Pear VC",
      "SignalFire",
      "a16z",
      "GitHub for Startups",
      "Malaika Commons",
      "Founders Common",
      "Founders You Should Know",
      "Brex Startup Community",
      "AI Hustle",
      "SF AI Agent Meetup",
      "Sapienne",
      "Founders Brew",
      "Homebrew Club",
      "Founders on Tap"
    ],
    exclude: {
      formats: [
        "hackathon",
        "buildathon",
        "code sprint",
        "coding sprint",
        "hack night",
        "webinar",
        "online event",
        "virtual only",
        "job fair"
      ],
      topics: [
        "physical ai",
        "robotics",
        "hardware ai",
        "frontier research",
        "research club",
        "paper reading",
        "ml research",
        "research scientist",
        "postdoc"
      ],
      eligibility: [
        "phd required",
        "postdoc required",
        "faculty only",
        "researchers only",
        "frontier lab only",
        "series a founders only",
        "series a+",
        "series b+"
      ]
    },
    search: {
      phrases: ["AI founders", "agent builders", "consumer AI founders", "AI product builders", "AI builders"],
      rooms: ["founder dinner", "founder salon", "operator roundtable", "founder breakfast", "builder salon", "happy hour"]
    },
    notes: [
      "Prefer B2C and consumer-facing AI events over B2B/enterprise events when room quality and actionability are comparable.",
      "Coding-agent and developer-tool events are only a partial fit: recommend them only when they also have founder, operator, product, customer, or go-to-market networking value.",
      "B2B-heavy events centered on enterprise SaaS sales, RevOps, demand generation, pipeline, CIO/CISO/CXO buyers, or procurement are lower priority unless they are clearly small founder/operator/builder rooms with strong AI agent or consumer AI relevance.",
      "Hub venues and communities lift roomQuality and networkingValue for otherwise relevant in-person founder rooms, but should not override topic, format, location, or eligibility penalties.",
      "Hackathons, buildathons, code sprints, and hack nights are long time-sink formats with weak networking: skip them unless the page is clearly only a short demo day or networking mixer attached to a hackathon."
    ],
    thresholds: { recommend: 80, review: 65 }
  },
  "built-in default profile"
);

export function parseProfile(raw: unknown, sourceLabel: string): ScoutProfile {
  const parsed = scoutProfileSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid scout profile (${sourceLabel}):\n${issues}`);
}

export function readProfileFile(path: string): ScoutProfile {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read scout profile ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const fileName = basename(path);
  const defaultName = fileName === PROFILE_FILE_NAME ? "custom" : basename(fileName, extname(fileName));
  const withName =
    raw && typeof raw === "object" && !Array.isArray(raw) && !("name" in raw)
      ? { ...(raw as Record<string, unknown>), name: defaultName }
      : raw;
  return parseProfile(withName, path);
}

/**
 * Profile resolution order:
 * 1. SCOUT_PROFILE — a preset name from profiles/ (e.g. "fintech") or a path to a YAML file.
 * 2. scout.profile.yaml in the working directory or any parent directory.
 * 3. The built-in default profile.
 */
export function loadProfile(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ProfileSelection {
  const cwd = options.cwd ?? process.cwd();
  const selector = options.env?.SCOUT_PROFILE?.trim();

  if (selector) {
    const path = resolveProfileSelector(selector, cwd);
    if (!path) {
      const presets = listProfilePresets(cwd);
      throw new Error(
        `SCOUT_PROFILE=${selector} did not match a profile file. Use a path to a YAML file or a preset name` +
          (presets.length ? ` (${presets.join(", ")}).` : ".")
      );
    }
    return {
      profile: readProfileFile(path),
      source: profileSourceLabel(path),
      selectedBy: selectorLooksLikePath(selector) ? "path" : "preset",
      path: resolve(path)
    };
  }

  const localProfile = findUpPath(cwd, PROFILE_FILE_NAME);
  if (localProfile) {
    return { profile: readProfileFile(localProfile), source: profileSourceLabel(localProfile), selectedBy: "file", path: resolve(localProfile) };
  }

  return { profile: DEFAULT_PROFILE, source: `built-in default (${DEFAULT_PROFILE_NAME})`, selectedBy: "default" };
}

/** Avoids exposing absolute paths (and the home directory in them) in logs and the admin UI. */
function profileSourceLabel(path: string): string {
  const parent = basename(dirname(path));
  return parent === PROFILES_DIR_NAME ? `${PROFILES_DIR_NAME}/${basename(path)}` : basename(path);
}

export function listProfilePresets(cwd = process.cwd()): string[] {
  const directory = findUpPath(cwd, PROFILES_DIR_NAME);
  if (!directory) return [];
  return readdirSync(directory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .map((file) => basename(file, extname(file)))
    .sort();
}

function selectorLooksLikePath(selector: string): boolean {
  return /[\\/]/.test(selector) || /\.ya?ml$/i.test(selector);
}

function resolveProfileSelector(selector: string, cwd: string): string | undefined {
  if (selectorLooksLikePath(selector)) {
    if (isAbsolute(selector)) return existsSync(selector) ? selector : undefined;
    return findUpPath(cwd, selector);
  }

  return findUpPath(cwd, `${PROFILES_DIR_NAME}/${selector}.yaml`) ?? findUpPath(cwd, `${PROFILES_DIR_NAME}/${selector}.yml`);
}

/** Looks for `relativePath` in `startDir` and each parent directory. */
export function findUpPath(startDir: string, relativePath: string): string | undefined {
  let current = resolve(startDir);
  while (true) {
    const candidate = resolve(current, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Keyword matching shared by discovery, scoring, and search planning.
// Matching is case-insensitive, ignores punctuation, and works on whole words.
// A keyword whose last word does not end in "s" also matches its plural
// ("founder" matches "founders"), so write keywords in singular form.
// ---------------------------------------------------------------------------

const keywordPatternCache = new Map<string, RegExp | null>();

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+&#@]+/g, " ")
    .trim();
}

export function findKeywordMatches(text: string, keywords: readonly string[]): string[] {
  const haystack = normalizeMatchText(text);
  if (!haystack) return [];
  return keywords.filter((keyword) => keywordPattern(keyword)?.test(haystack));
}

export function matchesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  const haystack = normalizeMatchText(text);
  if (!haystack) return false;
  return keywords.some((keyword) => keywordPattern(keyword)?.test(haystack));
}

function keywordPattern(keyword: string): RegExp | undefined {
  const normalized = normalizeMatchText(keyword);
  if (!normalized) return undefined;
  const cached = keywordPatternCache.get(normalized);
  if (cached !== undefined) return cached ?? undefined;

  const words = normalized.split(" ");
  const lastWord = words.pop() ?? "";
  const body = [...words.map(escapeRegex), pluralTolerant(lastWord)].join(" ");
  const pattern = new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
  keywordPatternCache.set(normalized, pattern);
  return pattern;
}

function pluralTolerant(word: string): string {
  const escaped = escapeRegex(word);
  if (word.length < 3 || !/^[a-z]+$/.test(word) || word.endsWith("s")) return escaped;
  return `${escaped}(?:s|es)?`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Derived views used across packages.
// ---------------------------------------------------------------------------

/** Every term that marks an event as local to the profile's region. */
export function localAreaTerms(profile: ScoutProfile): string[] {
  return unique([...profile.region.cities, ...profile.region.aliases]);
}

export function positiveTopics(profile: ScoutProfile): ProfileTopic[] {
  return profile.topics.filter((topic) => topic.weight > 0).sort((left, right) => right.weight - left.weight);
}

export function neutralTopics(profile: ScoutProfile): ProfileTopic[] {
  return profile.topics.filter((topic) => topic.weight === 0);
}

export function negativeTopics(profile: ScoutProfile): ProfileTopic[] {
  return profile.topics.filter((topic) => topic.weight < 0).sort((left, right) => left.weight - right.weight);
}

/** Keywords of every topic the profile cares about (weight >= 0). */
export function relevantTopicKeywords(profile: ScoutProfile): string[] {
  return unique(profile.topics.filter((topic) => topic.weight >= 0).flatMap((topic) => topic.keywords));
}

/** Search-engine exclusion operators for the profile's excluded formats, e.g. `-hackathon -"hack night"`. */
export function searchExclusions(profile: ScoutProfile, max = 3): string[] {
  const terms = profile.exclude.formats.filter((term) => /^[a-z0-9 -]+$/i.test(term));
  const singleWordFirst = [...terms.filter((term) => !term.includes(" ")), ...terms.filter((term) => term.includes(" "))];
  return singleWordFirst.slice(0, max).map((term) => (term.includes(" ") ? `-"${term}"` : `-${term}`));
}

export function slugifyLabel(value: string): string {
  return normalizeMatchText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "topic";
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
