import type { ExtractedEvent } from "./schemas.js";

export interface DedupeGroup {
  dedupeKey: string;
  event: ExtractedEvent;
  mergedIds: string[];
}

export interface DedupeComparableEvent {
  title: string;
  startAt?: string;
  timezone?: string;
  city?: string;
  hosts?: string[];
  organizers?: string[];
  canonicalUrl: string;
  sourceUrls: string[];
}

const DUPLICATE_TIME_WINDOW_MS = 3 * 60 * 60 * 1000;
const TITLE_SIMILARITY_THRESHOLD = 0.72;
const TITLE_SUBSET_THRESHOLD = 0.8;
const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "bay",
  "area",
  "by",
  "edition",
  "event",
  "events",
  "for",
  "in",
  "meetup",
  "networking",
  "of",
  "on",
  "sf",
  "san",
  "francisco",
  "the",
  "to",
  "with"
]);

export function dedupeEvents(events: ExtractedEvent[]): DedupeGroup[] {
  const groups = new Map<string, DedupeGroup>();
  const fuzzyGroups: DedupeGroup[] = [];

  for (const event of events) {
    const key = buildEventDedupeKey(event);
    const existing = groups.get(key);
    if (!existing) {
      const fuzzyMatch = fuzzyGroups.find((group) => areLikelyDuplicateEvents(group.event, event));
      if (fuzzyMatch) {
        fuzzyMatch.event = mergeEvents(fuzzyMatch.event, event);
        fuzzyMatch.mergedIds.push(event.id);
        groups.set(key, fuzzyMatch);
        continue;
      }

      const group = { dedupeKey: key, event, mergedIds: [event.id] };
      groups.set(key, group);
      fuzzyGroups.push(group);
      continue;
    }

    existing.event = mergeEvents(existing.event, event);
    existing.mergedIds.push(event.id);
  }

  return uniqueGroups([...groups.values()]);
}

export function buildEventDedupeKey(event: Pick<ExtractedEvent, "title" | "startAt" | "city"> & { timezone?: string }): string {
  const title = normalizeForDedupe(event.title)
    .replace(/\b(sf|san francisco|bay area|event|meetup)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const date = event.startAt ? localDateKey(event.startAt, event.timezone) : "unknown-date";
  const city = normalizeForDedupe(event.city ?? "unknown-city");
  return [title, date, city].join("|");
}

export function areLikelyDuplicateEvents(
  left: DedupeComparableEvent,
  right: DedupeComparableEvent
): boolean {
  if (urlsOverlap(left, right)) return true;
  if (!citiesCompatible(left.city, right.city)) return false;
  if (!datesCompatible(left, right)) return false;

  const comparison = titleComparison(left.title, right.title);
  if (comparison.similarity >= TITLE_SIMILARITY_THRESHOLD) return true;
  if (comparison.subset >= TITLE_SUBSET_THRESHOLD && organizerOverlap(left, right)) return true;
  return comparison.subset >= 0.9 && comparison.sharedTokens >= 3;
}

export function mergeEvents(left: ExtractedEvent, right: ExtractedEvent): ExtractedEvent {
  const confidence = Math.max(left.confidence, right.confidence);
  return {
    ...left,
    canonicalUrl: preferUrl(left.canonicalUrl, right.canonicalUrl),
    sourceUrls: unique([...left.sourceUrls, ...right.sourceUrls]),
    title: chooseLonger(left.title, right.title) ?? left.title,
    description: chooseLonger(left.description, right.description),
    startAt: left.startAt ?? right.startAt,
    endAt: left.endAt ?? right.endAt,
    timezone: left.timezone ?? right.timezone,
    city: left.city ?? right.city,
    venueText: left.venueText ?? right.venueText,
    locationPrecision: chooseLocationPrecision(left.locationPrecision, right.locationPrecision),
    hosts: unique([...left.hosts, ...right.hosts]),
    organizers: unique([...left.organizers, ...right.organizers]),
    platforms: unique([...left.platforms, ...right.platforms]),
    visibilityFlags: unique([...left.visibilityFlags, ...right.visibilityFlags]),
    registrationStatus:
      left.registrationStatus === "unknown" ? right.registrationStatus : left.registrationStatus,
    eventType: left.eventType === "other" ? right.eventType : left.eventType,
    confidence
  };
}

function normalizeForDedupe(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chooseLonger(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function chooseLocationPrecision(
  left: ExtractedEvent["locationPrecision"],
  right: ExtractedEvent["locationPrecision"]
): ExtractedEvent["locationPrecision"] {
  const order: ExtractedEvent["locationPrecision"][] = [
    "unknown",
    "city_only",
    "neighborhood",
    "exact"
  ];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function preferUrl(left: string, right: string): string {
  if (left.includes("lu.ma")) return left;
  if (right.includes("lu.ma")) return right;
  return left.length <= right.length ? left : right;
}

function uniqueGroups(groups: DedupeGroup[]): DedupeGroup[] {
  return groups.filter((group, index) => groups.indexOf(group) === index);
}

function urlsOverlap(
  left: Pick<ExtractedEvent, "canonicalUrl" | "sourceUrls">,
  right: Pick<ExtractedEvent, "canonicalUrl" | "sourceUrls">
): boolean {
  const leftUrls = new Set([left.canonicalUrl, ...left.sourceUrls].map(normalizeUrlForDedupe).filter(Boolean));
  return [right.canonicalUrl, ...right.sourceUrls].map(normalizeUrlForDedupe).some((url) => leftUrls.has(url));
}

function normalizeUrlForDedupe(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|referrer$|source$|fbclid$|gclid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().toLowerCase();
  }
}

function citiesCompatible(left?: string, right?: string): boolean {
  const leftCity = normalizeCity(left);
  const rightCity = normalizeCity(right);
  return !leftCity || !rightCity || leftCity === rightCity;
}

function normalizeCity(value?: string): string {
  const normalized = normalizeForDedupe(value ?? "");
  if (!normalized || normalized === "unknown city" || normalized === "unknown") return "";
  if (["sf", "san francisco"].includes(normalized)) return "san francisco";
  return normalized;
}

function datesCompatible(
  left: Pick<DedupeComparableEvent, "startAt" | "timezone">,
  right: Pick<DedupeComparableEvent, "startAt" | "timezone">
): boolean {
  if (!left.startAt || !right.startAt) return false;
  const leftTime = Date.parse(left.startAt);
  const rightTime = Date.parse(right.startAt);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return false;
  if (Math.abs(leftTime - rightTime) <= DUPLICATE_TIME_WINDOW_MS) return true;
  return localDateKey(left.startAt, left.timezone) === localDateKey(right.startAt, right.timezone);
}

function localDateKey(value: string, timezone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "invalid-date";
  if (!timezone) return date.toISOString().slice(0, 10);

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function titleComparison(left: string, right: string): { similarity: number; subset: number; sharedTokens: number } {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return { similarity: 0, subset: 0, sharedTokens: 0 };
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const sharedTokens = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return {
    similarity: sharedTokens / union,
    subset: sharedTokens / Math.min(leftSet.size, rightSet.size),
    sharedTokens
  };
}

function titleTokens(value: string): string[] {
  return normalizeForDedupe(value)
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .filter((token) => !TITLE_STOP_WORDS.has(token));
}

function organizerOverlap(
  left: Pick<DedupeComparableEvent, "hosts" | "organizers">,
  right: Pick<DedupeComparableEvent, "hosts" | "organizers">
): boolean {
  const leftNames = new Set([...(left.hosts ?? []), ...(left.organizers ?? [])].map(normalizeForDedupe).filter(Boolean));
  return [...(right.hosts ?? []), ...(right.organizers ?? [])].map(normalizeForDedupe).some((name) => leftNames.has(name));
}
