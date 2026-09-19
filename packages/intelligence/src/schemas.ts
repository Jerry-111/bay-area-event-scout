import { z } from "zod";

export const sourcePlatformSchema = z.enum([
  "exa",
  "x",
  "luma",
  "meetup",
  "eventbrite",
  "linkedin_indexed",
  "firecrawl",
  "manual",
  "mock",
  "web"
]);

export const fetchedPageSchema = z.object({
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  fetchMethod: z.enum(["firecrawl", "fetch", "mock"]),
  status: z.enum(["ok", "error"]),
  title: z.string().optional(),
  text: z.string().default(""),
  markdown: z.string().optional(),
  error: z.string().optional(),
  fetchedAt: z.string()
});

export type FetchedPage = z.infer<typeof fetchedPageSchema>;

const locationPrecisionSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (["city", "city_only", "city_level", "citywide"].includes(normalized)) return "city_only";
  if (["venue", "venue_only", "address", "exact_address", "exact_location", "specific_location"].includes(normalized)) return "exact";
  if (["neighborhood_only", "neighborhood_level", "area", "district", "approximate", "approx"].includes(normalized)) return "neighborhood";
  if (["", "unknown", "tbd", "not_specified", "unspecified", "online_unknown"].includes(normalized)) return "unknown";
  if (normalized.includes("exact") || normalized.includes("address") || normalized.includes("venue")) return "exact";
  if (normalized.includes("neighborhood") || normalized.includes("district")) return "neighborhood";
  if (normalized.includes("city")) return "city_only";
  return normalized;
}, z.enum(["exact", "neighborhood", "city_only", "unknown"]));

const registrationStatusSchema = z.preprocess((value) => {
  if (value == null) return "unknown";
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (["approval", "application", "apply", "requires_approval"].includes(normalized)) {
    return "approval_required";
  }
  if (["soldout", "sold_out"].includes(normalized)) return "sold_out";
  if (["", "tbd", "n/a", "none", "not_listed", "not_found"].includes(normalized)) return "unknown";
  if (["open", "approval_required", "sold_out", "closed", "unknown"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}, z.enum(["open", "approval_required", "sold_out", "closed", "unknown"]));

const eventTypeSchema = z.preprocess((value) => {
  if (value == null) return "other";
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (["fireside_chat", "talk", "speaker", "presentation"].includes(normalized)) return "panel";
  if (["meetup", "mixer", "networking", "social"].includes(normalized)) return "other";
  if (["roundtable", "conversation"].includes(normalized)) return "salon";
  if (["", "tbd", "n/a", "none", "not_listed", "not_found"].includes(normalized)) return "other";
  if ([
    "dinner",
    "breakfast",
    "happy_hour",
    "demo",
    "salon",
    "panel",
    "conference",
    "workshop",
    "online",
    "other"
  ].includes(normalized)) {
    return normalized;
  }
  return "other";
}, z.enum([
  "dinner",
  "breakfast",
  "happy_hour",
  "demo",
  "salon",
  "panel",
  "conference",
  "workshop",
  "online",
  "other"
]));

const optionalStringSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.string().optional()
);

const stringArraySchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []),
  z.array(z.string()).default([])
);

export const eventExtractionSchema = z.object({
  id: z.string().min(1),
  runId: optionalStringSchema,
  canonicalUrl: z.string().url(),
  sourceUrls: z.array(z.string().url()).min(1),
  title: z.string().min(3),
  description: optionalStringSchema,
  startAt: optionalStringSchema,
  endAt: optionalStringSchema,
  timezone: z.string().default("America/Los_Angeles"),
  city: optionalStringSchema,
  venueText: optionalStringSchema,
  locationPrecision: locationPrecisionSchema,
  hosts: stringArraySchema,
  organizers: stringArraySchema,
  platforms: stringArraySchema,
  visibilityFlags: stringArraySchema,
  registrationStatus: registrationStatusSchema.default("unknown"),
  eventType: eventTypeSchema.default("other"),
  confidence: z.preprocess((value) => {
    if (value == null || value === "" || value === "unknown") return 0.5;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0.5;
    return parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  }, z.number().min(0).max(1))
});

export type ExtractedEvent = z.infer<typeof eventExtractionSchema>;

export const eventScoreSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    eventId: record.eventId ?? record.event_id,
    shouldRecommend: normalizeBoolean(record.shouldRecommend ?? record.should_recommend),
    nextAction: normalizeNextAction(record.nextAction ?? record.next_action)
  };
}, z.object({
  eventId: z.string().min(1),
  totalScore: z.coerce.number().min(0).max(100),
  userFit: cappedScoreSchema(25),
  roomQuality: cappedScoreSchema(20),
  networkingValue: cappedScoreSchema(15),
  timeliness: cappedScoreSchema(10),
  locationActionability: cappedScoreSchema(10),
  novelty: cappedScoreSchema(10),
  evidenceConfidence: cappedScoreSchema(10),
  penalties: z.array(z.string()).default([]),
  shouldRecommend: z.boolean(),
  rationale: z.string().min(1),
  nextAction: z.enum(["apply", "rsvp", "ask_intro", "monitor", "skip"])
}));

export type StructuredEventScore = z.infer<typeof eventScoreSchema>;

export const feedbackTypeSchema = z.enum([
  "good",
  "bad",
  "very_my_type",
  "too_generic",
  "too_far",
  "want_intro",
  "not_relevant"
]);

export type FeedbackType = z.infer<typeof feedbackTypeSchema>;

export const missHuntClassificationSchema = z.object({
  eventTitle: z.string().min(1),
  eventUrl: z.string().url().optional(),
  happenedAt: z.string().optional(),
  wasMissed: z.boolean(),
  missReason: z.enum([
    "source_gap",
    "query_gap",
    "extraction_failure",
    "scoring_false_negative",
    "dedupe_error",
    "not_relevant",
    "unknown"
  ]),
  confidence: z.coerce.number().min(0).max(1),
  suggestedSource: z.string().optional(),
  suggestedQuery: z.string().optional(),
  rationale: z.string().min(1)
});

export type MissHuntClassification = z.infer<typeof missHuntClassificationSchema>;

export function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, schemaName: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  throw new Error(`${schemaName} validation failed: ${message}`);
}

function cappedScoreSchema(max: number): z.ZodType<number> {
  return z.preprocess((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value;
    if (parsed > max && parsed <= 100) return Math.round((parsed / 100) * max);
    if (parsed > 100) return max;
    return parsed;
  }, z.number().min(0).max(max));
}

function normalizeBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase().trim();
  if (["true", "yes", "recommend"].includes(normalized)) return true;
  if (["false", "no", "skip"].includes(normalized)) return false;
  return value;
}

function normalizeNextAction(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (["attend", "go", "join", "register"].includes(normalized)) return "rsvp";
  if (["apply", "rsvp", "ask_intro", "monitor", "skip"].includes(normalized)) return normalized;
  return "monitor";
}
