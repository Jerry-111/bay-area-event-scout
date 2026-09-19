import type { FeedbackType, NextAction, ScoutRun } from "@event-scout/shared";

export const feedbackTypes: FeedbackType[] = [
  "good",
  "bad",
  "very_my_type",
  "too_generic",
  "too_far",
  "want_intro",
  "not_relevant"
];

/** Feedback buttons shown directly on every card. The rest live behind "More". */
export const primaryFeedbackTypes: FeedbackType[] = ["good", "bad", "want_intro"];

export function isFeedbackType(value: string): value is FeedbackType {
  return feedbackTypes.includes(value as FeedbackType);
}

export function feedbackLabel(type: FeedbackType): string {
  const labels: Record<FeedbackType, string> = {
    good: "Good pick",
    bad: "Not for me",
    very_my_type: "Very my type",
    too_generic: "Too generic",
    too_far: "Too far away",
    want_intro: "Want intro",
    not_relevant: "Not relevant"
  };
  return labels[type];
}

/** One line explaining what each feedback button records. */
export function feedbackHint(type: FeedbackType): string {
  const hints: Record<FeedbackType, string> = {
    good: "Worth my time.",
    bad: "Missed the mark.",
    very_my_type: "A perfect fit: exactly the kind of event I want.",
    too_generic: "Too broad or too big a room.",
    too_far: "Right kind of event, wrong location.",
    want_intro: "I want in, but I need a warm introduction.",
    not_relevant: "Wrong topic entirely."
  };
  return hints[type];
}

export function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    apply: "Apply",
    rsvp: "RSVP",
    ask_intro: "Ask for an intro",
    monitor: "Keep watching",
    skip: "Skip"
  };
  return labels[action] ?? humanize(action);
}

/** Bucket used to colour the action pill. */
export function actionTone(action: string): "go" | "reach" | "wait" {
  if (action === "apply" || action === "rsvp") return "go";
  if (action === "ask_intro") return "reach";
  return "wait";
}

/** Score bands from the active scout profile. */
export interface ScoreThresholds {
  recommend: number;
  review: number;
}

export function actionFromScore(score: number, thresholds: ScoreThresholds): NextAction {
  if (score >= thresholds.recommend + 8) return "apply";
  if (score >= thresholds.recommend) return "rsvp";
  return "monitor";
}

/** Score bands drive the badge colour so a number is readable at a glance. */
export function scoreTone(score: number, thresholds: ScoreThresholds): "strong" | "pass" | "near" | "low" {
  if (score >= Math.min(100, thresholds.recommend + 5)) return "strong";
  if (score >= thresholds.recommend) return "pass";
  if (score >= thresholds.review) return "near";
  return "low";
}

export function scoreLabel(score: number, thresholds: ScoreThresholds): string {
  const labels = {
    strong: "Strong fit",
    pass: "Above the bar",
    near: "Just under the bar",
    low: "Below the bar"
  } as const;
  return labels[scoreTone(score, thresholds)];
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function formatTimeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function formatDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

/** "in 3 days" / "2 hours ago" — the fastest way to answer "is this stale?". */
export function formatRelative(value: string, now = Date.now()): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";

  const thresholds: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY]
  ];

  let amount = (time - now) / 1000;
  for (const [unit, size] of thresholds) {
    if (Math.abs(amount) < size) {
      return new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(Math.round(amount), unit);
    }
    amount /= size;
  }

  return "";
}

export function formatDuration(run: ScoutRun): string {
  if (!run.finishedAt) return run.status === "running" ? "still running" : "unknown";
  const startedAt = new Date(run.startedAt).getTime();
  const finishedAt = new Date(run.finishedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return "unknown";
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export function isRunStuck(run: ScoutRun): boolean {
  return run.status === "running" && Date.now() - new Date(run.startedAt).getTime() > 2 * 60 * 60 * 1000;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll("\"", "&quot;");
}

/** Safe to drop inside a single-quoted JS string in an inline event handler. */
export function escapeJsAttr(value: unknown): string {
  return escapeAttr(String(value ?? "").replaceAll("\\", "\\\\").replaceAll("'", "\\'"));
}
