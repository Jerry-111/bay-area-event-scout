import type { EventCandidate, EventScore, FeedbackType } from "@event-scout/shared";
import {
  actionLabel,
  actionTone,
  escapeAttr,
  escapeHtml,
  escapeJsAttr,
  feedbackHint,
  feedbackLabel,
  feedbackTypes,
  formatDateTime,
  formatRelative,
  humanize,
  primaryFeedbackTypes,
  scoreLabel,
  scoreTone,
  type ScoreThresholds
} from "./format.js";

/** Component maxima from docs/scoring-rubric.md, so a raw number reads as "22 of 25". */
const scoreComponents: Array<{ label: string; key: keyof EventScore; max: number }> = [
  { label: "User fit", key: "userFit", max: 25 },
  { label: "Room quality", key: "roomQuality", max: 20 },
  { label: "Networking", key: "networkingValue", max: 15 },
  { label: "Timeliness", key: "timeliness", max: 10 },
  { label: "Location", key: "locationActionability", max: 10 },
  { label: "Novelty", key: "novelty", max: 10 },
  { label: "Evidence", key: "evidenceConfidence", max: 10 }
];

export function link(label: string, href: string): string {
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

export function sectionHead(title: string, hint: string, count?: number): string {
  return `<div class="section-head">
    <div class="titlerow">
      <h2>${escapeHtml(title)}</h2>
      ${typeof count === "number" ? `<span class="count-chip">${count}</span>` : ""}
    </div>
    <p class="hint">${escapeHtml(hint)}</p>
  </div>`;
}

export function emptyState(title: string, body: string, actionHtml = ""): string {
  return `<div class="empty">
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(body)}</span>
    ${actionHtml}
  </div>`;
}

export function tag(label: string, tone: "go" | "reach" | "wait" | "plain" = "plain"): string {
  return `<span class="tag${tone === "plain" ? "" : ` tag-${tone}`}">${escapeHtml(label)}</span>`;
}

export function tableWrap(headers: string[], bodyHtml: string): string {
  return `<div class="table-wrap"><table>
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table></div>`;
}

export function scoreBadge(score: number, thresholds: ScoreThresholds): string {
  const rounded = Math.round(score);
  return `<div class="scorebadge score-${scoreTone(rounded, thresholds)}" title="${escapeAttr(`${scoreLabel(rounded, thresholds)} — the scout recommends events scoring ${thresholds.recommend} or higher`)}">
    <b>${rounded}</b><span>/ 100</span>
  </div>`;
}

/** Date plus a relative hint, because "is this soon?" is the first question asked. */
export function whenText(startAt: string | undefined): string {
  if (!startAt) return "Date not confirmed";
  const relative = formatRelative(startAt);
  return relative ? `${formatDateTime(startAt)} (${relative})` : formatDateTime(startAt);
}

export function whereText(event: EventCandidate | undefined): string {
  if (!event) return "Location not confirmed";
  return [event.city, event.venueText].filter(Boolean).join(" · ") || "Location not confirmed";
}

export function eventSummaryLine(event: EventCandidate | undefined): string {
  if (!event) return "Event details unavailable";
  return `${whenText(event.startAt)} · ${whereText(event)}`;
}

export interface EventCardModel {
  eventId: string;
  title: string;
  href?: string;
  startAt?: string;
  where: string;
  score: number;
  thresholds: ScoreThresholds;
  action?: string;
  reasonLabel: string;
  reason: string;
  footnote?: string;
  event?: EventCandidate;
  scoreDetail?: EventScore;
}

/**
 * Every list on the Events tab renders the same card, so a recommendation and a
 * near miss stay directly comparable.
 */
export function eventCard(model: EventCardModel): string {
  const title = model.href ? link(model.title, model.href) : escapeHtml(model.title);
  const action = model.action ? actionLabel(model.action) : "";
  return `<article class="panel eventcard">
    <div class="eventcard-head">
      <div>
        <h3>${title}</h3>
        <div class="eventcard-when"><b>${escapeHtml(whenText(model.startAt))}</b><br>${escapeHtml(model.where)}</div>
      </div>
      ${scoreBadge(model.score, model.thresholds)}
    </div>
    ${action ? `<div class="taglist">${tag(action, actionTone(model.action ?? ""))}${eventTypeTag(model.event)}${registrationTag(model.event)}</div>` : ""}
    <div class="callout"><b>${escapeHtml(model.reasonLabel)}</b>${escapeHtml(model.reason)}</div>
    ${model.footnote ? `<div class="note note-quiet">${escapeHtml(model.footnote)}</div>` : ""}
    <details class="more">
      <summary>Score breakdown and event details</summary>
      <div class="more-body">
        ${scoreBars(model.scoreDetail, model.score)}
        ${eventDetails(model.event)}
        ${sourceLinks(model.event)}
      </div>
    </details>
    ${feedbackControls(model.eventId)}
  </article>`;
}

function eventTypeTag(event: EventCandidate | undefined): string {
  if (!event?.eventType) return "";
  return tag(humanize(event.eventType));
}

function registrationTag(event: EventCandidate | undefined): string {
  const status = event?.registrationStatus;
  if (!status || status === "unknown") return "";
  return tag(humanize(status), status === "open" || status === "approval_required" ? "go" : "wait");
}

export function scoreBars(score: EventScore | undefined, fallbackTotal?: number): string {
  if (!score) {
    return `<p class="note note-quiet">No scoring breakdown was recorded for this event.</p>`;
  }

  const total = score.totalScore ?? score.score ?? fallbackTotal ?? 0;
  const rows = scoreComponents
    .map((component) => ({ ...component, value: score[component.key] }))
    .filter((component): component is typeof component & { value: number } => typeof component.value === "number");
  const penalties = score.penalties ?? score.risks ?? [];

  return `<div class="bars">
    <div class="bar total"><span>Total</span><span class="value">${Math.round(total)} / 100</span></div>
    ${rows.map((row) => `<div class="bar">
      <span>${escapeHtml(row.label)}</span>
      <span class="track"><span class="fill" style="width:${Math.max(0, Math.min(100, (row.value / row.max) * 100)).toFixed(0)}%"></span></span>
      <span class="value">${row.value} / ${row.max}</span>
    </div>`).join("")}
  </div>
  ${penalties.length ? `<div class="callout"><b>Point deductions</b>${escapeHtml(penalties.join("; "))}</div>` : ""}`;
}

export function eventDetails(event: EventCandidate | undefined): string {
  if (!event) return "";
  return `<div class="kv">
    ${kv("Format", event.eventType ? humanize(event.eventType) : "unknown")}
    ${kv("Registration", event.registrationStatus ? humanize(event.registrationStatus) : "unknown")}
    ${kv("Location detail", humanize(event.locationPrecision))}
    ${kv("Hosts", (event.hosts ?? []).join(", ") || "unknown")}
  </div>
  ${event.description ? `<p class="note">${escapeHtml(event.description)}</p>` : ""}
  ${event.risks?.length ? `<div class="callout"><b>Risks</b>${escapeHtml(event.risks.join("; "))}</div>` : ""}`;
}

export function kv(label: string, value: string | number): string {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

export function sourceLinks(event: EventCandidate | undefined): string {
  if (!event) return "";
  const urls = event.sourceUrls?.length ? event.sourceUrls : [event.canonicalUrl];
  const uniqueUrls = [...new Set(urls)].filter(Boolean).slice(0, 3);
  if (uniqueUrls.length === 0) return "";
  return `<p class="note note-quiet">Sources: ${uniqueUrls
    .map((url, index) => link(index === 0 ? "event page" : `mention ${index + 1}`, url))
    .join(" · ")}</p>`;
}

/**
 * Two clear verdicts plus an intro request stay on the card; the more specific
 * reasons sit behind "More" so a card is not a wall of seven buttons.
 */
export function feedbackControls(eventId: string): string {
  const secondary = feedbackTypes.filter((type) => !primaryFeedbackTypes.includes(type));
  return `<div class="feedback">
    <span class="label">Rate it for your team (ratings are listed under Tuning)</span>
    <div class="row">
      ${primaryFeedbackTypes.map((type) => feedbackButton(eventId, type, type === "good")).join("")}
      ${secondary.length
        ? `<button type="button" onclick="toggleMoreFeedback(this)" aria-expanded="false">More…</button>`
        : ""}
    </div>
    ${secondary.length
      ? `<div class="row" hidden>${secondary.map((type) => feedbackButton(eventId, type, false)).join("")}</div>`
      : ""}
  </div>`;
}

function feedbackButton(eventId: string, type: FeedbackType, primary: boolean): string {
  return `<button type="button"${primary ? ` class="primary"` : ""} title="${escapeAttr(feedbackHint(type))}" onclick="sendFeedback(this,'${escapeJsAttr(eventId)}','${type}')">${escapeHtml(feedbackLabel(type))}</button>`;
}
