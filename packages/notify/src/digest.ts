import { DEFAULT_PROFILE, filterEventsInFutureWindow, type AppEnv, type EventCandidate, type ScoutProfile } from "@event-scout/shared";

export interface DigestOptions {
  appBaseUrl?: string;
  maxEvents?: number;
  maxAlternatives?: number;
  maxLength?: number;
  now?: Date;
  /** Score bands from the scout profile; defaults to the built-in profile's 80 / 65. */
  thresholds?: ScoutProfile["thresholds"];
}

const DEFAULT_TELEGRAM_SAFE_LENGTH = 3900;
const TRUNCATED_NOTICE = "Digest truncated to fit Telegram message limits. Open the admin dashboard for the full run.";
const TITLE_MAX_LENGTH = 120;
const WHEN_WHERE_MAX_LENGTH = 150;
const SUMMARY_MAX_LENGTH = 170;
const LINK_MAX_LENGTH = 280;

export function renderTelegramDigest(events: EventCandidate[], options: DigestOptions = {}): string {
  const maxAlternatives = options.maxAlternatives;
  const maxLength = options.maxLength ?? DEFAULT_TELEGRAM_SAFE_LENGTH;
  const { recommend, review } = options.thresholds ?? DEFAULT_PROFILE.thresholds;
  const selected = filterEventsInFutureWindow(events, { now: options.now })
    .filter((event) => eventScore(event) >= review)
    .sort((left, right) => eventScore(right) - eventScore(left));
  const recommendations = applyOptionalLimit(
    selected.filter((event) => eventScore(event) >= recommend),
    options.maxEvents
  );
  const alternatives = applyOptionalLimit(
    selected.filter((event) => eventScore(event) < recommend),
    maxAlternatives
  );

  if (!recommendations.length && !alternatives.length) {
    return "Bay Event Scout: no recommendations cleared the bar for this run.";
  }

  const totalEvents = recommendations.length + alternatives.length;
  const lines = [
    `Bay Event Scout: ${totalEvents} event${plural(totalEvents)}`,
    `${recommendations.length} recommended, ${alternatives.length} review-worthy`,
    ""
  ];

  if (recommendations.length) {
    lines.push(`Recommended (${recommend}+)`, "");
    recommendations.forEach((event, index) => {
      lines.push(...renderEventBlock(event, index + 1, options.appBaseUrl));
      lines.push("");
    });
  }

  if (alternatives.length) {
    lines.push(`Possible (${review}-${recommend - 1})`, "");
    alternatives.forEach((event, index) => {
      lines.push(...renderEventBlock(event, index + 1, options.appBaseUrl));
      lines.push("");
    });
  }

  const adminLink = renderAdminLink(options.appBaseUrl);
  if (adminLink) lines.push(adminLink);

  return fitDigestToMaxLength(lines.join("\n").trim(), maxLength);
}

function renderEventBlock(event: EventCandidate, rank: number, _appBaseUrl?: string): string[] {
  const score = typeof event.score === "number" ? Math.round(event.score) : "unscored";
  const summary = summarizeEvent(event);
  const lines = [
    `${rank}. ${escapeHtml(truncateText(event.title, TITLE_MAX_LENGTH))} (${score})`,
    formatWhenWhere(event)
  ];

  if (summary) lines.push(`Why: ${escapeHtml(summary)}`);
  lines.push(`Link: ${escapeHtml(truncateText(event.canonicalUrl, LINK_MAX_LENGTH))}`);

  return lines;
}

function eventScore(event: EventCandidate): number {
  return typeof event.score === "number" ? event.score : 0;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

export function renderFeedbackLinks(eventId: string, appBaseUrl?: string): string {
  if (!appBaseUrl) {
    return `Feedback: good=/feedback?eventId=${encodeURIComponent(
      eventId
    )}&type=good bad=/feedback?eventId=${encodeURIComponent(eventId)}&type=bad`;
  }

  const base = appBaseUrl.replace(/\/$/, "");
  const good = `${base}/feedback?eventId=${encodeURIComponent(eventId)}&type=good`;
  const bad = `${base}/feedback?eventId=${encodeURIComponent(eventId)}&type=bad`;
  const intro = `${base}/feedback?eventId=${encodeURIComponent(eventId)}&type=want_intro`;
  return `Feedback: <a href="${good}">good</a> | <a href="${bad}">bad</a> | <a href="${intro}">want intro</a>`;
}

export function digestFromEnv(events: EventCandidate[], env: AppEnv): string {
  return renderTelegramDigest(events, {
    appBaseUrl: env.appBaseUrl,
    thresholds: env.profile.thresholds
  });
}

function formatWhenWhere(event: EventCandidate): string {
  const when = event.startAt ? formatDateTime(event.startAt, event.timezone) : "Date TBD";
  const location = [event.venueText, event.city].filter(Boolean).join(", ");
  return escapeHtml(truncateText([when, location].filter(Boolean).join(" - "), WHEN_WHERE_MAX_LENGTH));
}

function formatDateTime(value: string, timezone: string | undefined): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function renderAdminLink(appBaseUrl?: string): string {
  if (!appBaseUrl) return "";
  return `Full details: <a href="${escapeHtml(adminDashboardUrl(appBaseUrl))}">admin dashboard</a>`;
}

function adminDashboardUrl(appBaseUrl: string): string {
  try {
    const url = new URL(appBaseUrl);
    url.searchParams.delete("token");
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return appBaseUrl.replace(/\/$/, "");
  }
}

function summarizeEvent(event: EventCandidate): string {
  const raw = event.reasons?.find((reason) => reason.trim()) ?? event.description ?? "";
  if (!raw) return "";
  return truncateText(firstSentence(raw), SUMMARY_MAX_LENGTH);
}

function firstSentence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.+?[.!?])(?:\s|$)/);
  return match?.[1] ?? normalized;
}

function applyOptionalLimit<T>(items: T[], limit: number | undefined): T[] {
  return typeof limit === "number" ? items.slice(0, limit) : items;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Converts a rendered Telegram digest (HTML, built with `escapeHtml` and the
 * occasional `<a href>`) into plain text for consoles that cannot render
 * HTML: friends running the scout locally without a Telegram bot configured.
 * Same content and order as what would be sent to Telegram, just readable.
 */
export function toPlainTextDigest(html: string): string {
  return html
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const text = unescapeHtml(stripTags(label)).trim();
      const url = unescapeHtml(href);
      return text && text !== url ? `${text} (${url})` : url;
    })
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => unescapeHtml(line))
    .join("\n");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

/**
 * Markdown for a GitHub Actions job summary: the plain-text digest with its title and section
 * lines as headings, bare URLs (which GitHub turns into links), and hard line breaks so each
 * event keeps its own lines.
 */
export function toMarkdownDigest(html: string): string {
  const lines = toPlainTextDigest(html).split("\n");
  return lines
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (index === 0) return `### ${escapeMarkdownText(trimmed)}`;
      if (/^(Recommended|Possible) \(\d+(-\d+|\+)\)$/.test(trimmed)) return `#### ${trimmed}`;
      return `${escapeMarkdownText(trimmed)}  `;
    })
    .join("\n");
}

/**
 * Backslash-escapes the characters that would turn event titles into emphasis, code, links, or
 * HTML, while leaving URLs untouched so GitHub still turns them into links. A leading "1." stays
 * as it is: each event is meant to render as a numbered item.
 */
function escapeMarkdownText(line: string): string {
  return line
    .split(/(https?:\/\/\S+)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/[\\`*_[\]<>~|]/g, "\\$&")))
    .join("");
}

/** Reverses `escapeHtml`. Order matters: unescape `&amp;` last so a literal `&lt;` never turns back into `<`. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function fitDigestToMaxLength(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;
  if (maxLength <= TRUNCATED_NOTICE.length + 2) return truncateText(message, maxLength);

  const suffix = `\n\n${TRUNCATED_NOTICE}`;
  const limit = maxLength - suffix.length;
  const sections = message.split("\n\n");
  let output = "";

  for (const section of sections) {
    const candidate = output ? `${output}\n\n${section}` : section;
    if (candidate.length > limit) break;
    output = candidate;
  }

  if (!output) return `${truncateText(message, limit)}${suffix}`;
  return `${output}${suffix}`.trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
