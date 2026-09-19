import type { AppEnv, CandidateUrl, EventCandidate, EventScore, FeedbackType, Recommendation, ScoutRun, SourcePlatform } from "@event-scout/shared";
import type {
  AdminDashboard,
  DashboardFeedbackSummary,
  DashboardMissedEvent,
  DashboardOrganizerPerformance,
  DashboardRecommendation,
  DashboardRejectionSummary,
  DashboardReviewCandidate,
  DashboardSourcePerformance,
  DashboardSuppressedEvent,
  FeedbackRow
} from "./types.js";

/**
 * Builds the full admin dashboard from plain arrays. Every backend (mock,
 * local file, Postgres) funnels its data through this one function so the
 * dashboard reads identically no matter where the rows came from.
 */
export function buildDashboard(input: {
  env: AppEnv;
  runs: ScoutRun[];
  candidates: CandidateUrl[];
  topRecommendations: Recommendation[];
  dashboardRecommendations: Recommendation[];
  recommendationHistory: DashboardRecommendation[];
  suppressedEvents: DashboardSuppressedEvent[];
  rejectedCandidates: CandidateUrl[];
  events: EventCandidate[];
  scores: EventScore[];
  reviewCandidates: DashboardReviewCandidate[];
  sourcePerformance: DashboardSourcePerformance[];
  organizerPerformance: DashboardOrganizerPerformance[];
  feedbackSummary: DashboardFeedbackSummary[];
  tasteSignals: string[];
  missedEvents: DashboardMissedEvent[];
  dataGaps: string[];
}): AdminDashboard {
  const latestRun = input.runs[0];
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const scoreByEventId = latestScoresByEvent(input.scores);
  const latestCandidates = latestRun
    ? input.candidates.filter((candidate) => candidate.runId === latestRun.id)
    : input.candidates;
  const dataGaps = [...new Set(input.dataGaps)];
  if (input.missedEvents.length === 0) {
    dataGaps.push("Miss Hunt has not produced enough missed-event data yet.");
  }
  if (input.sourcePerformance.length === 0) {
    dataGaps.push("Source/query performance needs more candidate data.");
  }
  if (input.organizerPerformance.length === 0) {
    dataGaps.push("Organizer performance needs extracted event host data.");
  }
  const recommendedEvents = dedupeDashboardRecommendations(input.dashboardRecommendations.map((recommendation) => ({
    recommendation,
    event: eventById.get(recommendation.eventId),
    score: scoreByEventId.get(recommendation.eventId)
  })));
  const usedEventKeys = new Set(recommendedEvents.flatMap((item) => item.event ? eventDedupeKeys(item.event) : []));
  const reviewCandidates = dedupeReviewCandidates(input.reviewCandidates, usedEventKeys);
  const suppressedEvents = dedupeSuppressedEvents(input.suppressedEvents, usedEventKeys);
  const recommendationHistory = dedupeDashboardRecommendations(input.recommendationHistory);

  return {
    runs: input.runs,
    candidateCounts: countBy(input.candidates, (candidate) => candidate.status),
    topRecommendations: input.topRecommendations,
    rejectedCandidates: input.rejectedCandidates,
    events: input.events,
    scores: input.scores,
    today: {
      latestRunId: latestRun?.id,
      latestRunStatus: latestRun?.status,
      nextScheduledScan: nextConfiguredScan(input.env.scanSchedules),
      scanMode: latestRun?.stats.scanMode ?? "light",
      xPostsUsedToday: xPostsUsedToday(input.runs),
      xDailyBudget: input.env.budgets.maxXPostsPerDay,
      candidateCount: latestRun?.stats.candidatesFound ?? latestCandidates.length,
      eventCount: latestRun?.stats.eventsExtracted ?? input.events.length,
      recommendationCount: latestRun?.stats.recommendationsCreated ?? input.dashboardRecommendations.length,
      warning: todayWarning(input.runs)
    },
    health: dashboardHealth(input.runs),
    recommendedEvents,
    recommendationHistory,
    suppressedEvents,
    reviewCandidates,
    rejectionSummary: buildRejectionSummary(latestCandidates, reviewCandidates, latestRun),
    sourcePerformance: input.sourcePerformance,
    organizerPerformance: input.organizerPerformance,
    feedbackSummary: input.feedbackSummary,
    tasteSignals: input.tasteSignals,
    missedEvents: input.missedEvents,
    dataGaps: [...new Set(dataGaps)],
    thresholds: input.env.profile.thresholds,
    profile: { name: input.env.profile.name, source: input.env.profileSource, persona: input.env.profile.persona }
  };
}

export function scoringModelLabel(env: AppEnv): string {
  if (env.mockMode || !env.llm.enabled) return "heuristic";
  return `${env.llm.provider}:${env.llm.models.score}`;
}

function dedupeDashboardRecommendations(rows: DashboardRecommendation[]): DashboardRecommendation[] {
  return dedupeByEvent(rows, (row) => row.event, (left, right) => right.recommendation.score - left.recommendation.score);
}

function dedupeReviewCandidates(rows: DashboardReviewCandidate[], usedEventKeys: Set<string>): DashboardReviewCandidate[] {
  return dedupeByEvent(
    rows.filter((row) => !eventDedupeKeys(row.event).some((key) => usedEventKeys.has(key))),
    (row) => row.event,
    (left, right) => scoreValue(right.score, right.event.score) - scoreValue(left.score, left.event.score),
    usedEventKeys
  );
}

function dedupeSuppressedEvents(rows: DashboardSuppressedEvent[], usedEventKeys: Set<string>): DashboardSuppressedEvent[] {
  return dedupeByEvent(
    rows.filter((row) => !eventDedupeKeys(row.event).some((key) => usedEventKeys.has(key))),
    (row) => row.event,
    (left, right) => scoreValue(right.score, right.event.score) - scoreValue(left.score, left.event.score),
    usedEventKeys
  );
}

function dedupeByEvent<T>(
  rows: T[],
  getEvent: (row: T) => EventCandidate | undefined,
  compare: (left: T, right: T) => number,
  usedEventKeys?: Set<string>
): T[] {
  const selected: T[] = [];
  for (const row of rows.slice().sort(compare)) {
    const event = getEvent(row);
    if (!event) {
      selected.push(row);
      continue;
    }
    const keys = eventDedupeKeys(event);
    if (keys.some((key) => usedEventKeys?.has(key) || selected.some((item) => {
      const selectedEvent = getEvent(item);
      return selectedEvent ? eventsLookDuplicate(event, selectedEvent) : false;
    }))) {
      continue;
    }
    for (const key of keys) usedEventKeys?.add(key);
    selected.push(row);
  }
  return selected;
}

function eventsLookDuplicate(left: EventCandidate, right: EventCandidate): boolean {
  const leftKeys = eventDedupeKeys(left);
  const rightKeys = new Set(eventDedupeKeys(right));
  if (leftKeys.some((key) => rightKeys.has(key))) return true;
  if (localEventDate(left) !== localEventDate(right)) return false;
  if (normalizeDashboardCity(left.city) !== normalizeDashboardCity(right.city)) return false;

  const leftTokens = dashboardTitleTokens(left.title);
  const rightTokens = dashboardTitleTokens(right.title);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  const subset = shared / Math.min(leftTokens.length, rightTokens.length);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return subset >= 0.82 || shared / union >= 0.72;
}

function eventDedupeKeys(event: EventCandidate): string[] {
  const urls = [event.canonicalUrl, ...(event.sourceUrls ?? [])]
    .map(normalizeDashboardUrl)
    .filter(Boolean);
  const titleDateCity = [
    "title",
    dashboardTitleTokens(event.title).join(" "),
    localEventDate(event),
    normalizeDashboardCity(event.city)
  ].join("|");
  return [...new Set([...urls, titleDateCity])];
}

function normalizeDashboardUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|referrer$|source$|fbclid$|gclid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function dashboardTitleTokens(value: string): string[] {
  const stopWords = new Set(["a", "an", "and", "area", "bay", "event", "events", "for", "in", "meetup", "networking", "of", "on", "sf", "san", "francisco", "the", "to", "with"]);
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function localEventDate(event: EventCandidate): string {
  if (!event.startAt) return "unknown-date";
  const date = new Date(event.startAt);
  if (Number.isNaN(date.getTime())) return event.startAt.slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: event.timezone ?? "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function normalizeDashboardCity(value: string | undefined): string {
  const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized || normalized === "unknown") return "";
  if (["sf", "san francisco"].includes(normalized)) return "san francisco";
  return normalized;
}

function scoreValue(score: EventScore | undefined, fallback = 0): number {
  return score?.totalScore ?? score?.score ?? fallback;
}

export function buildReviewCandidates(
  events: EventCandidate[],
  scores: EventScore[],
  thresholds: AdminDashboard["thresholds"]
): DashboardReviewCandidate[] {
  const eventById = new Map(events.map((event) => [event.id, event]));
  return scores
    .filter((score) => {
      const value = score.totalScore ?? score.score ?? 0;
      return value >= thresholds.review && value < thresholds.recommend;
    })
    .sort((left, right) => (right.totalScore ?? right.score ?? 0) - (left.totalScore ?? left.score ?? 0))
    .slice(0, 25)
    .flatMap((score) => {
      const event = score.eventId ? eventById.get(score.eventId) : undefined;
      if (!event) return [];
      return [{
        event,
        score,
        reason: score.rationale ?? "Promising, but below the recommendation threshold."
      }];
    });
}

export function buildMemorySourcePerformance(
  candidates: CandidateUrl[],
  events: EventCandidate[],
  recommendations: Recommendation[]
): DashboardSourcePerformance[] {
  const recommendedEventIds = new Set(recommendations.map((recommendation) => recommendation.eventId));
  const rows = new Map<string, DashboardSourcePerformance>();
  for (const candidate of candidates) {
    const label = candidate.sourceQuery || candidate.sourcePlatform;
    const key = `${candidate.sourcePlatform}:${label}`;
    const row = rows.get(key) ?? {
      label,
      sourceType: candidate.sourcePlatform,
      candidateCount: 0,
      eventCount: 0,
      recommendationCount: 0,
      noiseCount: 0
    };
    row.candidateCount += 1;
    if (candidate.status === "rejected" || candidate.status === "error") row.noiseCount += 1;
    rows.set(key, row);
  }

  for (const row of rows.values()) {
    const matchingEvents = events.filter((event) => event.sourcePlatforms?.includes(row.sourceType as SourcePlatform));
    row.eventCount = matchingEvents.length;
    row.recommendationCount = matchingEvents.filter((event) => recommendedEventIds.has(event.id)).length;
    if (row.eventCount === 0 && row.recommendationCount === 0) {
      row.note = "No event attribution linked yet.";
    }
  }

  return [...rows.values()].sort((left, right) => right.candidateCount - left.candidateCount).slice(0, 12);
}

export function buildMemoryOrganizerPerformance(
  events: EventCandidate[],
  scores: EventScore[],
  recommendations: Recommendation[]
): DashboardOrganizerPerformance[] {
  const scoreByEventId = latestScoresByEvent(scores);
  const recommendationCounts = countBy(recommendations, (recommendation) => recommendation.eventId);
  const rows = new Map<string, { eventIds: Set<string>; recommendationCount: number; scores: number[] }>();

  for (const event of events) {
    const organizers = [...new Set([...(event.hosts ?? []), ...(event.organizers ?? [])].map((item) => item.trim()).filter(Boolean))];
    const score = scoreByEventId.get(event.id)?.totalScore ?? scoreByEventId.get(event.id)?.score ?? event.score ?? 0;
    for (const organizer of organizers) {
      const row = rows.get(organizer) ?? { eventIds: new Set<string>(), recommendationCount: 0, scores: [] };
      if (!row.eventIds.has(event.id)) {
        row.eventIds.add(event.id);
        row.recommendationCount += recommendationCounts[event.id] ?? 0;
        row.scores.push(score);
      }
      rows.set(organizer, row);
    }
  }

  return [...rows.entries()]
    .map(([organizer, row]) => ({
      organizer,
      eventCount: row.eventIds.size,
      recommendationCount: row.recommendationCount,
      maxScore: Math.max(...row.scores),
      avgScore: Math.round((row.scores.reduce((sum, score) => sum + score, 0) / row.scores.length) * 10) / 10
    }))
    .sort((left, right) => right.maxScore - left.maxScore || right.eventCount - left.eventCount || left.organizer.localeCompare(right.organizer))
    .slice(0, 15);
}

export function buildRecommendationRows(
  recommendations: Recommendation[],
  events: EventCandidate[],
  scores: EventScore[]
): DashboardRecommendation[] {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const scoreByEventId = latestScoresByEvent(scores);
  return recommendations
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((recommendation) => ({
      recommendation,
      event: eventById.get(recommendation.eventId),
      score: scoreByEventId.get(recommendation.eventId)
    }));
}

export function buildSuppressedEvents(
  events: EventCandidate[],
  scores: EventScore[],
  latestRecommendations: Recommendation[],
  historicalRecommendations: Recommendation[],
  thresholds: AdminDashboard["thresholds"]
): DashboardSuppressedEvent[] {
  const latestRecommendationIds = new Set(latestRecommendations.map((recommendation) => recommendation.eventId));
  const historicalByEventId = new Map(historicalRecommendations.map((recommendation) => [recommendation.eventId, recommendation]));
  const historicalByFingerprint = new Map<string, Recommendation>();
  for (const recommendation of historicalRecommendations) {
    const event = events.find((item) => item.id === recommendation.eventId);
    if (!event) continue;
    historicalByFingerprint.set(eventFingerprint(event), recommendation);
  }

  return events.flatMap((event) => {
    if (latestRecommendationIds.has(event.id)) return [];
    const score = latestScoresByEvent(scores).get(event.id);
    const value = score?.totalScore ?? score?.score ?? event.score ?? 0;
    if (value < thresholds.recommend || !score) return [];
    const previousRecommendation = historicalByEventId.get(event.id) ?? historicalByFingerprint.get(eventFingerprint(event));
    return [{
      event,
      score,
      reason: previousRecommendation
        ? "Previously recommended; hidden from the latest digest to avoid repeats."
        : "Scored above the recommendation threshold but did not enter the latest recommendation set.",
      previousRecommendation
    }];
  }).sort((left, right) => (right.score.totalScore ?? right.score.score ?? 0) - (left.score.totalScore ?? left.score.score ?? 0)).slice(0, 25);
}

export function buildFeedbackSummary(feedback: FeedbackRow[]): DashboardFeedbackSummary[] {
  const rows = new Map<FeedbackType, DashboardFeedbackSummary>();
  for (const item of feedback) {
    const row = rows.get(item.feedbackType) ?? { feedbackType: item.feedbackType, count: 0, latestAt: item.createdAt };
    row.count += 1;
    if (!row.latestAt || new Date(item.createdAt).getTime() > new Date(row.latestAt).getTime()) {
      row.latestAt = item.createdAt;
    }
    rows.set(item.feedbackType, row);
  }
  return [...rows.values()].sort((left, right) => right.count - left.count || String(right.latestAt).localeCompare(String(left.latestAt)));
}

export function buildTasteSignals(feedback: FeedbackRow[], events: EventCandidate[]): string[] {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const positive = new Set<FeedbackType>(["good", "very_my_type", "want_intro"]);
  const negative = new Set<FeedbackType>(["bad", "too_generic", "too_far", "not_relevant"]);
  const likedOrganizers = new Map<string, number>();
  const dislikedTypes = new Map<string, number>();

  for (const item of feedback) {
    const event = eventById.get(item.eventId);
    if (!event) continue;
    if (positive.has(item.feedbackType)) {
      for (const organizer of [...(event.hosts ?? []), ...(event.organizers ?? [])].map((value) => value.trim()).filter(Boolean)) {
        likedOrganizers.set(organizer, (likedOrganizers.get(organizer) ?? 0) + 1);
      }
    }
    if (negative.has(item.feedbackType) && event.eventType) {
      dislikedTypes.set(event.eventType, (dislikedTypes.get(event.eventType) ?? 0) + 1);
    }
  }

  const signals: string[] = [];
  const topOrganizer = [...likedOrganizers.entries()].sort((left, right) => right[1] - left[1])[0];
  if (topOrganizer) signals.push(`Liked organizer signal: ${topOrganizer[0]} (${topOrganizer[1]} positive feedback item${plural(topOrganizer[1])}).`);
  const topDislikedType = [...dislikedTypes.entries()].sort((left, right) => right[1] - left[1])[0];
  if (topDislikedType) signals.push(`Down-rank signal: ${topDislikedType[0]} has ${topDislikedType[1]} negative feedback item${plural(topDislikedType[1])}.`);
  if (feedback.length > 0) signals.push(`${feedback.length} feedback item${plural(feedback.length)} captured for future scoring calibration.`);
  return signals;
}

export function buildTasteSignalsFromSummaries(feedbackSummary: DashboardFeedbackSummary[]): string[] {
  if (feedbackSummary.length === 0) return [];
  const total = feedbackSummary.reduce((sum, item) => sum + item.count, 0);
  const top = feedbackSummary[0];
  return [
    `${total} feedback item${plural(total)} captured.`,
    top ? `Most common signal: ${top.feedbackType.replaceAll("_", " ")} (${top.count}).` : undefined
  ].filter((value): value is string => Boolean(value));
}

function eventFingerprint(event: EventCandidate): string {
  return `${event.canonicalUrl.toLowerCase()}|${event.title.trim().toLowerCase()}`;
}

export function latestScoresByEvent(scores: EventScore[]): Map<string, EventScore> {
  const byEventId = new Map<string, EventScore>();
  for (const score of scores) {
    if (!score.eventId || byEventId.has(score.eventId)) continue;
    byEventId.set(score.eventId, score);
  }
  return byEventId;
}

function buildRejectionSummary(
  candidates: CandidateUrl[],
  reviewCandidates: DashboardReviewCandidate[],
  latestRun: ScoutRun | undefined
): DashboardRejectionSummary[] {
  const counts = new Map<(typeof rejectionOrder)[number], number>();
  const examples = new Map<(typeof rejectionOrder)[number], CandidateUrl[]>();
  for (const candidate of candidates.filter((item) => item.status === "rejected" || item.status === "error")) {
    const key = rejectionKey(candidate.rejectionReason ?? candidate.snippet ?? candidate.title ?? "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const rows = examples.get(key) ?? [];
    if (rows.length < 8) {
      rows.push(candidate);
      examples.set(key, rows);
    }
  }
  if (reviewCandidates.length > 0) {
    counts.set("low_score", (counts.get("low_score") ?? 0) + reviewCandidates.length);
  }
  if (latestRun && (!latestRun.stats.xEnabled || latestRun.stats.xBudgetRemaining <= 0)) {
    counts.set("schedule_budget", (counts.get("schedule_budget") ?? 0) + 1);
  }

  return rejectionOrder.flatMap((key) => {
    const count = counts.get(key) ?? 0;
    if (count === 0) return [];
    const metadata = rejectionMetadata[key];
    return [{
      key,
      label: metadata.label,
      count,
      description: metadata.description(count),
      examples: examples.get(key) ?? []
    }];
  });
}

const rejectionOrder = [
  "past_event",
  "time_sink",
  "generic_networking",
  "online_only",
  "missing_date",
  "outside_bay",
  "sold_out_closed",
  "profile_mismatch",
  "low_score",
  "schedule_budget",
  "other"
] as const;

const rejectionMetadata: Record<(typeof rejectionOrder)[number], { label: string; description: (count: number) => string }> = {
  past_event: {
    label: "Past event",
    description: (count) => `${count} candidate${plural(count)} had explicit dates that were already past.`
  },
  time_sink: {
    label: "Time-sink format",
    description: (count) => `${count} candidate${plural(count)} looked like hackathons, buildathons, or long low-networking formats.`
  },
  generic_networking: {
    label: "Generic networking",
    description: (count) => `${count} candidate${plural(count)} looked too broad, generic, or vendor-led.`
  },
  online_only: {
    label: "Online-only",
    description: (count) => `${count} candidate${plural(count)} appeared to be online-only instead of Bay Area in-person.`
  },
  missing_date: {
    label: "Missing date",
    description: (count) => `${count} candidate${plural(count)} did not have a reliable upcoming date.`
  },
  outside_bay: {
    label: "Outside Bay",
    description: (count) => `${count} candidate${plural(count)} appeared outside the Bay Area.`
  },
  sold_out_closed: {
    label: "Sold out or closed",
    description: (count) => `${count} candidate${plural(count)} looked sold out, closed, or no longer actionable.`
  },
  profile_mismatch: {
    label: "Excluded by your profile",
    description: (count) => `${count} candidate${plural(count)} matched a format, topic, or eligibility rule the scout profile excludes.`
  },
  low_score: {
    label: "Low or near-miss score",
    description: (count) => `${count} event${plural(count)} had some signal but did not clear the recommendation bar.`
  },
  schedule_budget: {
    label: "Skipped due to schedule/budget",
    description: () => "The latest run used light mode or skipped X because of the scan schedule or remaining budget."
  },
  other: {
    label: "Other filters",
    description: (count) => `${count} candidate${plural(count)} were filtered by another pipeline rule.`
  }
};

function rejectionKey(value: string): (typeof rejectionOrder)[number] {
  const normalized = value.toLowerCase();
  const tokenized = normalized.replace(/[^a-z0-9]+/g, "_");
  if (tokenized.includes("past_event") || normalized.includes("past event")) return "past_event";
  if (
    tokenized.includes("time_sink") ||
    normalized.includes("hackathon") ||
    normalized.includes("buildathon") ||
    normalized.includes("hack night") ||
    normalized.includes("low networking")
  ) {
    return "time_sink";
  }
  if (normalized.includes("online") || normalized.includes("webinar") || normalized.includes("virtual")) return "online_only";
  if (
    tokenized.startsWith("excluded_") ||
    tokenized.startsWith("eligibility_gate") ||
    tokenized.startsWith("user_mismatch")
  ) {
    return "profile_mismatch";
  }
  if (tokenized.includes("junk")) return "generic_networking";
  if (
    tokenized.includes("missing_date") ||
    tokenized.includes("invalid_date") ||
    normalized.includes("date missing") ||
    normalized.includes("no date") ||
    normalized.includes("date not confirmed") ||
    normalized.includes("unclear date")
  ) {
    return "missing_date";
  }
  if (normalized.includes("outside") || normalized.includes("not bay") || normalized.includes("remote")) return "outside_bay";
  if (normalized.includes("sold out") || normalized.includes("closed") || normalized.includes("waitlist")) return "sold_out_closed";
  if (normalized.includes("generic") || normalized.includes("networking") || normalized.includes("vendor")) return "generic_networking";
  if (normalized.includes("score") || normalized.includes("low")) return "low_score";
  if (normalized.includes("budget") || normalized.includes("schedule") || normalized.includes("skip")) return "schedule_budget";
  return "other";
}

function dashboardHealth(runs: ScoutRun[]): AdminDashboard["health"] {
  const latestRun = runs[0];
  if (!latestRun) {
    return { status: "warning", message: "No runs have been recorded yet." };
  }
  if (isRunStuck(latestRun)) {
    return { status: "failing", message: "Latest run appears stuck." };
  }
  if (latestRun.status === "failed") {
    return { status: "failing", message: latestRun.error ? `Latest run failed: ${latestRun.error}` : "Latest run failed." };
  }
  const latestSuccess = runs.find((run) => run.status === "succeeded");
  if (!latestSuccess || Date.now() - new Date(latestSuccess.startedAt).getTime() > 24 * 60 * 60 * 1000) {
    return { status: "warning", message: "No successful run in the last 24 hours." };
  }
  return { status: "healthy", message: "Latest successful run is recent." };
}

function todayWarning(runs: ScoutRun[]): string | undefined {
  const health = dashboardHealth(runs);
  return health.status === "healthy" ? undefined : health.message;
}

function isRunStuck(run: ScoutRun): boolean {
  return run.status === "running" && Date.now() - new Date(run.startedAt).getTime() > 2 * 60 * 60 * 1000;
}

function xPostsUsedToday(runs: ScoutRun[]): number {
  const today = localDateKey(new Date());
  return runs
    .filter((run) => localDateKey(new Date(run.startedAt)) === today)
    .reduce((sum, run) => sum + (run.stats.xPostsRead ?? 0), 0);
}

function nextConfiguredScan(schedules: string[]): string | undefined {
  if (schedules.length === 0) return undefined;
  const nowMinutes = pacificMinutes(new Date());
  const parsed = schedules
    .map((schedule) => ({ schedule, minutes: scheduleMinutes(schedule) }))
    .filter((item): item is { schedule: string; minutes: number } => item.minutes !== undefined)
    .sort((left, right) => left.minutes - right.minutes);
  if (parsed.length === 0) return undefined;
  const laterToday = parsed.find((item) => item.minutes > nowMinutes);
  if (laterToday) return `${laterToday.schedule} PT today`;
  return `${parsed[0].schedule} PT tomorrow`;
}

function scheduleMinutes(schedule: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(schedule);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function pacificMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function countBy<T>(rows: T[], getKey: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = getKey(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
