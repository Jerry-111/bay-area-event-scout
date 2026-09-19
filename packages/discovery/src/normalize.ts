import { createHash } from "node:crypto";
import {
  findKeywordMatches,
  localAreaTerms,
  matchesAnyKeyword,
  negativeTopics,
  relevantTopicKeywords,
  type ScoutProfile
} from "@event-scout/shared";
import type { CandidateUrl, SourceRecord, SourceType } from "./types.js";

export type CandidateIntent = "concrete_event" | "listing_source" | "organizer_source" | "low_event_confidence";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "ref",
  "ref_src",
  "referrer",
  "spm",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term"
]);

/** Event-quality words that help regardless of profile. */
const GENERIC_SIGNAL_TERMS = [
  "approval",
  "application",
  "apply to attend",
  "curated",
  "invite",
  "invite only",
  "rsvp",
  "demo night",
  "demo day",
  "startup",
  "luma",
  "meetup"
];

/** Promotional noise that is never an event worth scoring. */
const JUNK_TERMS = ["coupon", "discount", "giveaway", "sponsorship"];

const MAX_SIGNAL_HITS = 8;

/** Positive terms for candidate ranking, derived from the profile. */
function profileSignalTerms(profile: ScoutProfile): string[] {
  return [
    ...GENERIC_SIGNAL_TERMS,
    ...relevantTopicKeywords(profile),
    ...profile.audience,
    ...profile.formats.prefer,
    ...profile.hubs,
    ...localAreaTerms(profile)
  ];
}

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

export function stableId(parts: string[]): string {
  return createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 24);
}

export function normalizeCandidateUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.hash = "";

  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }

  for (const key of Array.from(parsed.searchParams.keys())) {
    if (key.startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }

  parsed.searchParams.sort();

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

export function isLumaUrl(url: string): boolean {
  try {
    const host = new URL(normalizeCandidateUrl(url)).hostname;
    return host === "lu.ma" || host.endsWith(".lu.ma") || host === "luma.com" || host.endsWith(".luma.com");
  } catch {
    return false;
  }
}

export function isIndexedLinkedInUrl(url: string): boolean {
  try {
    const host = new URL(normalizeCandidateUrl(url)).hostname;
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

export function isMeetupUrl(url: string): boolean {
  try {
    const host = new URL(normalizeCandidateUrl(url)).hostname;
    return host === "meetup.com" || host.endsWith(".meetup.com");
  } catch {
    return false;
  }
}

export function isEventbriteUrl(url: string): boolean {
  try {
    const host = new URL(normalizeCandidateUrl(url)).hostname;
    return host === "eventbrite.com" || host.endsWith(".eventbrite.com");
  } catch {
    return false;
  }
}

export function isKnownEventPlatformUrl(url: string): boolean {
  return isLumaUrl(url) || isMeetupUrl(url) || isEventbriteUrl(url) || isPartifulUrl(url);
}

export function isPartifulUrl(url: string): boolean {
  try {
    const host = new URL(normalizeCandidateUrl(url)).hostname;
    return host === "partiful.com" || host.endsWith(".partiful.com");
  } catch {
    return false;
  }
}

const STATIC_ASSET_EXTENSION = /\.(ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|json|xml|txt|woff2?|ttf|otf|map|pdf|mp4|webm|webmanifest)$/i;

/** First path segments on event platforms that are app pages, not events. */
const NON_EVENT_PLATFORM_PAGES = new Set([
  "signin",
  "sign-in",
  "login",
  "logout",
  "signup",
  "sign-up",
  "explore",
  "discover",
  "pricing",
  "about",
  "terms",
  "privacy",
  "help",
  "support",
  "create",
  "home",
  "settings",
  "dashboard",
  "search",
  "download",
  "ios",
  "android",
  "blog",
  "careers",
  "jobs",
  "static",
  "assets"
]);

/**
 * Links that can never be an event page: static assets (favicons, images, scripts) and app pages
 * on event platforms such as luma.com/signin or luma.com/explore.
 */
export function isNonEventLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (STATIC_ASSET_EXTENSION.test(parsed.pathname)) return true;
    if (!isKnownEventPlatformUrl(url)) return false;
    const firstSegment = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    return !firstSegment || NON_EVENT_PLATFORM_PAGES.has(firstSegment);
  } catch {
    return true;
  }
}

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return Array.from(new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, ""))));
}

/**
 * Cheap pre-LLM filter. Rejection reasons name the profile rule that matched
 * (e.g. `excluded_format:hackathon`) so the admin view can explain every drop.
 */
export function classifyRejectionReason(
  candidate: Pick<CandidateUrl, "canonicalUrl" | "title" | "snippet">,
  options: { now?: Date; profile: ScoutProfile }
): string | undefined {
  const now = options.now ?? new Date();
  const profile = options.profile;
  const title = candidate.title ?? "";
  const snippet = candidate.snippet ?? "";
  const primaryText = `${candidate.canonicalUrl} ${title}`;
  const haystack = `${primaryText} ${snippet}`;
  if (hasExplicitPastEventDate(primaryText, now)) return "past_event_explicit_date";
  if (
    !isListingDerivedCandidateTitle(title) &&
    hasExplicitPastEventDate(snippet, now) &&
    !hasExplicitFutureEventDate(snippet, now)
  ) {
    return "past_event_explicit_date";
  }

  const excludedFormat = findKeywordMatches(haystack, profile.exclude.formats)[0];
  if (excludedFormat) return `excluded_format:${excludedFormat}`;

  const excludedTopic = findKeywordMatches(haystack, profile.exclude.topics)[0];
  if (excludedTopic) return `excluded_topic:${excludedTopic}`;

  const eligibilityGate = findKeywordMatches(haystack, profile.exclude.eligibility)[0];
  if (eligibilityGate) return `eligibility_gate:${eligibilityGate}`;

  if (matchesAnyKeyword(haystack, JUNK_TERMS)) return "obvious_low_signal_or_junk";

  const lower = haystack.toLowerCase();
  if (lower.includes("linkedin.com") && !lower.includes("event") && !lower.includes("luma")) {
    return "linkedin_indexed_but_event_signal_unclear";
  }

  return undefined;
}

export function classifyCandidateIntent(
  candidate: Pick<CandidateUrl, "canonicalUrl" | "title" | "snippet">,
  profile: ScoutProfile
): CandidateIntent {
  const canonicalUrl = normalizeCandidateUrl(candidate.canonicalUrl);
  const title = candidate.title ?? "";
  const snippet = candidate.snippet ?? "";
  const haystack = `${canonicalUrl} ${title} ${snippet}`;

  if (isSpecificEventUrl(canonicalUrl)) return "concrete_event";
  if (isListingLikePage(canonicalUrl, title, snippet)) return "listing_source";
  if (isOrganizerLikePage(canonicalUrl, title, snippet)) return "organizer_source";
  if (matchesAnyKeyword(haystack, localAreaTerms(profile)) && hasFutureOrActionEvidence(haystack)) return "concrete_event";
  return "low_event_confidence";
}

/** True when the text mentions a format the profile excludes (hackathons by default). */
export function hasExcludedFormat(text: string, profile: ScoutProfile): boolean {
  return matchesAnyKeyword(text, profile.exclude.formats);
}

export function hasExplicitPastEventDate(text: string, now = new Date()): boolean {
  return explicitEventDates(text, now).some((date) => date < startOfLocalToday(now));
}

export function hasExplicitFutureEventDate(text: string, now = new Date()): boolean {
  return explicitEventDates(text, now).some((date) => date >= startOfLocalToday(now));
}

function explicitEventDates(text: string, now: Date): Date[] {
  const lower = text.toLowerCase();
  const dates: Date[] = [];

  for (const match of lower.matchAll(/\b(20\d{2})[-/_](0?[1-9]|1[0-2])[-/_](0?[1-9]|[12]\d|3[01])\b/g)) {
    const date = dateFromParts(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date) dates.push(date);
  }

  for (const match of lower.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+([0-3]?\d)(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/g)) {
    const month = MONTHS[match[1] ?? ""];
    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : now.getFullYear();
    const date = typeof month === "number" ? dateFromParts(year, month, day) : undefined;
    if (date) dates.push(date);
  }

  for (const match of lower.matchAll(/\b(20\d{2})\b/g)) {
    if (Number(match[1]) < now.getFullYear() && hasEventContext(lower, match.index ?? 0)) {
      const date = dateFromParts(Number(match[1]), 0, 1);
      if (date) dates.push(date);
    }
  }

  return dates;
}

function startOfLocalToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isListingDerivedCandidateTitle(title: string): boolean {
  const normalized = title.toLowerCase();
  return normalized.startsWith("public source link from ") || normalized.startsWith("public source retained:");
}

function dateFromParts(year: number, month: number, day: number): Date | undefined {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return undefined;
  return date;
}

function hasEventContext(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 80), index + 80);
  return /(event|meetup|dinner|breakfast|salon|conference|summit|workshop|demo|panel|rsvp|luma|eventbrite|meetup\.com)/i.test(window);
}

/** 0-100 priority used to order candidates before the (budgeted) LLM extraction step. */
export function scoreCandidateSignal(
  candidate: Pick<CandidateUrl, "canonicalUrl" | "title" | "snippet">,
  profile: ScoutProfile
): number {
  const haystack = `${candidate.canonicalUrl} ${candidate.title ?? ""} ${candidate.snippet}`;
  const hits = Math.min(MAX_SIGNAL_HITS, findKeywordMatches(haystack, profileSignalTerms(profile)).length);
  const lowerPriorityHits = negativeTopics(profile).filter((topic) => matchesAnyKeyword(haystack, topic.keywords)).length;
  const excludedFormatHits = findKeywordMatches(haystack, profile.exclude.formats).length;
  const junkPenalty = (findKeywordMatches(haystack, JUNK_TERMS).length + excludedFormatHits) * 12;
  const timeSinkPenalty = excludedFormatHits > 0 ? 35 : 0;
  const lumaBoost = isLumaUrl(candidate.canonicalUrl) ? 18 : 0;
  const meetupBoost = isMeetupUrl(candidate.canonicalUrl) ? 8 : 0;
  const eventbriteBoost = isEventbriteUrl(candidate.canonicalUrl) ? 6 : 0;
  const linkedinPenalty = isIndexedLinkedInUrl(candidate.canonicalUrl) ? 8 : 0;
  const pastPenalty = classifyRejectionReason(candidate, { profile }) === "past_event_explicit_date" ? 40 : 0;
  const intent = classifyCandidateIntent(candidate, profile);
  const intentAdjustment = intent === "concrete_event"
    ? 18
    : intent === "listing_source"
      ? -18
      : intent === "organizer_source"
        ? -12
        : -28;
  return Math.max(
    0,
    Math.min(
      100,
      30 + (hits - lowerPriorityHits) * 7 + lumaBoost + meetupBoost + eventbriteBoost + intentAdjustment - junkPenalty - timeSinkPenalty - linkedinPenalty - pastPenalty
    )
  );
}

function isSpecificEventUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const path = parsed.pathname.toLowerCase();
    const segments = path.split("/").filter(Boolean);

    if (isEventbriteUrl(url)) return /^\/e\/[^/]+tickets-\d+/.test(path);
    if (isMeetupUrl(url)) return /\/events\/\d+/.test(path);
    if (isPartifulUrl(url)) return segments.length >= 1 && !["events", "explore"].includes(segments[0] ?? "");
    if (isLumaUrl(url)) {
      if (segments.length !== 1) return false;
      const slug = segments[0] ?? "";
      if (["ai", "sf", "bay-area", "san-francisco", "calendar", "discover"].includes(slug)) return false;
      if (slug.startsWith("user") || slug.startsWith("calendar")) return false;
      if (slug.endsWith("events") || slug.includes("calendar")) return false;
      return true;
    }

    if (host.includes("linkedin.com")) return path.includes("/events/");
    return false;
  } catch {
    return false;
  }
}

function isListingLikePage(url: string, title: string, snippet: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const text = `${title} ${snippet}`.toLowerCase();
    if (isSpecificEventUrl(url)) return false;
    if (/(\/events?\/?$|\/calendar\/?$|\/ai-radar\/?$|\/cities\/|\/city\/|\/tag\/|\/category\/)/.test(path)) return true;
    return /\b(events calendar|event calendar|upcoming events|events this week|week of|roundup|newsletter|digest|radar)\b/.test(text);
  } catch {
    return false;
  }
}

function isOrganizerLikePage(url: string, title: string, snippet: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const text = `${title} ${snippet}`.toLowerCase();
    if (isSpecificEventUrl(url) || isListingLikePage(url, title, snippet)) return false;
    if (/(\/about\/?$|\/apply\/?$|\/companies\/?$|\/community\/?$|\/members\/?$)/.test(path)) return true;
    return /\b(community|coworking space|accelerator|venture fund|portfolio|membership|member owned|event space)\b/.test(text);
  } catch {
    return false;
  }
}

function hasFutureOrActionEvidence(text: string): boolean {
  return /\b(upcoming|this week|next week|rsvp|apply|register|tickets?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|20\d{2})\b/i.test(text);
}

export function sourceTypeForUrl(url: string): SourceType {
  try {
    const parsed = new URL(normalizeCandidateUrl(url));
    const host = parsed.hostname;
    const path = parsed.pathname.toLowerCase();
    if (isLumaUrl(url)) return "luma_calendar";
    if (host === "x.com" || host === "twitter.com") return "x_account";
    if (host.endsWith("linkedin.com")) return "linkedin_indexed_author";
    if (host.includes("meetup")) return "meetup_group";
    if (host.includes("eventbrite")) return "eventbrite_organizer";
    if (host.includes("partiful")) return "organizer_site";
    if (host.includes("substack") || host.includes("beehiiv")) return "newsletter";
    if (host.includes("vc") || path.includes("ventures")) return "vc_page";
    if (path.includes("founder-house") || host.includes("founder")) return "founder_house";
    return "organizer_site";
  } catch {
    return "unknown";
  }
}

/** Without a profile (and no connector score) a source gets a neutral quality score. */
export function sourceFromCandidate(candidate: CandidateUrl, profile?: ScoutProfile): SourceRecord {
  const sourceUrl = candidate.sourceUrl || candidate.canonicalUrl;
  const normalizedUrl = normalizeCandidateUrl(sourceUrl);
  const sourceType = candidate.sourceType ?? sourceTypeForUrl(normalizedUrl);
  const parsed = new URL(normalizedUrl);
  const handle = candidate.sourceHandle ?? (sourceType === "x_account" ? parsed.pathname.split("/").filter(Boolean)[0] : undefined);
  const name = candidate.sourceName ?? handle ?? parsed.hostname;
  const qualityScore = candidate.sourceScore ?? (profile ? scoreCandidateSignal(candidate, profile) : 50);

  return {
    id: stableId([sourceType, handle ?? "", normalizedUrl]),
    sourceType,
    name,
    url: normalizedUrl,
    handle,
    qualityScore,
    noiseRate: candidate.rejectionReason ? 0.35 : 0.1,
    freshnessScore: 75,
    eventsFoundCount: 1,
    recommendedEventsCount: 0,
    lastSeenAt: candidate.discoveredAt
  };
}
