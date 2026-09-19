import type { AdminDashboard } from "@event-scout/db";
import type { EventCandidate, EventScore, ScoutRun } from "@event-scout/shared";
import {
  emptyState,
  eventCard,
  kv,
  link,
  sectionHead,
  tableWrap,
  tag,
  whereText,
  type EventCardModel
} from "./components.js";
import {
  actionFromScore,
  actionLabel,
  escapeAttr,
  escapeHtml,
  feedbackLabel,
  formatDateOnly,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTimeOnly,
  humanize,
  isRunStuck,
  plural,
  titleCase
} from "./format.js";
import { baseStyles, dashboardStyles } from "./styles.js";

/** Where the dashboard's data is actually coming from, so the whole team knows what they are looking at. */
export type DashboardDataSource = "mock" | "file" | "postgres";

export interface DashboardViewOptions {
  dataSource: DashboardDataSource;
  canSignOut: boolean;
}

interface TabDefinition {
  id: string;
  label: string;
  badge?: string;
  badgeTone?: "plain" | "alert";
  render: () => string;
}

export function renderDashboard(dashboard: AdminDashboard, options: DashboardViewOptions): string {
  const tabs: TabDefinition[] = [
    {
      id: "today",
      label: "Today",
      badge: dashboard.recommendedEvents.length ? String(dashboard.recommendedEvents.length) : undefined,
      render: () => renderTodayTab(dashboard)
    },
    {
      id: "history",
      label: "History",
      render: () => renderHistoryTab(dashboard)
    },
    {
      id: "health",
      label: "Health",
      badge: dashboard.health.status === "healthy" ? undefined : "!",
      badgeTone: "alert",
      render: () => renderHealthTab(dashboard)
    },
    {
      id: "tuning",
      label: "Tuning",
      render: () => renderTuningTab(dashboard)
    }
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Event Scout</title>
  <style>${baseStyles}${dashboardStyles}</style>
</head>
<body>
  <header class="appbar">
    <div class="appbar-inner">
      <div class="brandrow">
        <div class="brand">
          <h1>Event Scout</h1>
          <span class="mode" title="${escapeAttr(dataSourceHint(options.dataSource))}">${escapeHtml(dataSourceLabel(options.dataSource))}</span>
        </div>
        <div class="toolbar">
          <button type="button" onclick="window.location.reload()">Refresh</button>
          <button type="button" onclick="copyShareLink(this)">Copy link</button>
          ${options.canSignOut ? `<a class="btnlink" href="/logout">Sign out</a>` : ""}
        </div>
      </div>
      <div class="metaline">
        <span class="status status-${dashboard.health.status}">${escapeHtml(titleCase(dashboard.health.status))}</span>
        ${renderLastRunMeta(dashboard)}
      </div>
      <div class="tabs" role="tablist" aria-label="Dashboard sections">
        ${tabs.map((tab, index) => renderTabButton(tab, index === 0)).join("")}
      </div>
    </div>
  </header>
  <main>
    ${tabs.map((tab, index) => `<div class="tabpanel" role="tabpanel" id="panel-${tab.id}" aria-labelledby="tab-${tab.id}"${index === 0 ? "" : " hidden"}>${tab.render()}</div>`).join("")}
  </main>
  <script>${dashboardScript}</script>
</body>
</html>`;
}

function renderTabButton(tab: TabDefinition, selected: boolean): string {
  const badge = tab.badge
    ? `<span class="badge${tab.badgeTone === "alert" ? " alert" : ""}">${escapeHtml(tab.badge)}</span>`
    : "";
  return `<button type="button" class="tab" role="tab" id="tab-${tab.id}" aria-controls="panel-${tab.id}" aria-selected="${selected}" onclick="showTab('${tab.id}')">${escapeHtml(tab.label)}${badge}</button>`;
}

function renderLastRunMeta(dashboard: AdminDashboard): string {
  const shown = dashboard.runs.find((run) => run.id === dashboard.today.latestRunId) ?? dashboard.runs[0];
  if (!shown) return `<span>No scan has run yet</span>`;
  const when = (iso: string): string => {
    const relative = formatRelative(iso);
    return `${escapeHtml(formatTimeOnly(iso))}${relative ? ` (${escapeHtml(relative)})` : ""}`;
  };
  if (dashboard.today.activeRunStartedAt) {
    return `<span>New scan running since ${when(dashboard.today.activeRunStartedAt)} · showing the ${escapeHtml(formatTimeOnly(shown.startedAt))} scan</span>`;
  }
  if (shown.status === "running") return `<span>Scan running since ${when(shown.startedAt)}</span>`;
  return `<span>Last scan ${when(shown.startedAt)}</span>`;
}

function dataSourceLabel(dataSource: DashboardDataSource): string {
  if (dataSource === "mock") return "mock data";
  if (dataSource === "file") return "local file data";
  return "Postgres";
}

function dataSourceHint(dataSource: DashboardDataSource): string {
  // Deliberately does not say "from `pnpm scout:mock`": this dashboard's mock data is a fixed
  // built-in seed, independent of the worker process, so it is the same regardless of whether
  // (or when) you separately ran `pnpm scout:mock` in a terminal. Saying otherwise implies a
  // pipeline connection between the two that does not exist in mock mode.
  if (dataSource === "mock") return "Built-in sample data for a first look, not the output of a specific run. Nothing here is real.";
  if (dataSource === "file") return "Reading from a local JSON file (SCOUT_DATA_DIR). Fine for one person; use Postgres to share across a team.";
  return "Reading from the shared Postgres database.";
}

/* ---------------------------------------------------------------- Today --- */

function renderTodayTab(dashboard: AdminDashboard): string {
  if (dashboard.runs.length === 0) {
    return renderGettingStarted();
  }

  const segments = [
    {
      id: "act",
      label: "Act now",
      count: dashboard.recommendedEvents.length,
      hint: `Cleared the scout's bar (${dashboard.thresholds.recommend}+) and has not been sent before. Decide today — good rooms fill up.`,
      body: renderActNow(dashboard)
    },
    {
      id: "maybe",
      label: "Worth a look",
      count: dashboard.reviewCandidates.length,
      hint: "Scored just under the bar. Skim these in case the scout was too strict — your feedback moves the line.",
      body: renderWorthALook(dashboard)
    },
    {
      id: "hidden",
      label: "Hidden",
      count: dashboard.suppressedEvents.length,
      hint: "Scored well but deliberately held back: already sent to you before, or a duplicate of something you have seen.",
      body: renderHidden(dashboard)
    }
  ];

  return `${dashboard.health.status === "healthy" ? "" : `<div class="banner banner-warning">${escapeHtml(dashboard.health.message)} Today's list may be incomplete — <button type="button" onclick="showTab('health')">check scout health</button></div>`}
  ${dashboard.today.warning ? `<div class="banner banner-warning">${escapeHtml(dashboard.today.warning)}</div>` : ""}
  ${renderContextBar(dashboard)}
  <section class="section">
    <div class="segmented" role="group" aria-label="Which events to show">
      ${segments.map((segment, index) => `<button type="button" class="seg" aria-pressed="${index === 0}" onclick="showSegment('${segment.id}')" id="seg-${segment.id}">${escapeHtml(segment.label)}<span class="badge">${segment.count}</span></button>`).join("")}
    </div>
    ${segments.map((segment, index) => `<div class="section" id="segment-${segment.id}"${index === 0 ? "" : " hidden"}>
      <p class="hint">${escapeHtml(segment.hint)}</p>
      ${segment.body}
    </div>`).join("")}
  </section>`;
}

/** First-run experience: nothing to act on yet, so explain the two ways to get sample or real data instead of showing three empty lists. */
function renderGettingStarted(): string {
  return `<section class="section">
    ${sectionHead(
      "Welcome to Event Scout",
      "This dashboard shows what the scout finds once it has run at least one scan."
    )}
    ${emptyState(
      "No scans yet",
      "Run `pnpm scout:mock` to see sample data, or `pnpm scout:real` for real results. Refresh this page once a scan finishes."
    )}
  </section>`;
}

/**
 * One line of context above the picks: how a scan of many links narrowed to a
 * few, plus the answer to "why so few?" one click away. Per-run detail lives on
 * the Health tab rather than repeating here.
 */
function renderContextBar(dashboard: AdminDashboard): string {
  const run = dashboard.runs[0];
  const today = dashboard.today;
  const links = run?.stats.candidatesFound ?? today.candidateCount;
  const events = run?.stats.eventsExtracted ?? today.eventCount;
  const picks = run?.stats.recommendationsCreated ?? today.recommendationCount;
  const facts = [
    `${today.scanMode} scan`,
    run ? formatDuration(run) : "",
    today.nextScheduledScan ? `next scan ${today.nextScheduledScan}` : "",
    `X ${today.xPostsUsedToday}/${today.xDailyBudget}`
  ].filter(Boolean);

  return `<div class="panel contextbar">
    <div class="flow">
      <span><b>${links}</b>${escapeHtml(plural(links, "link"))} found</span>
      <span class="arrow">&rarr;</span>
      <span><b>${events}</b>${escapeHtml(plural(events, "event"))} parsed</span>
      <span class="arrow">&rarr;</span>
      <span class="final"><b>${picks}</b>recommended</span>
      <button type="button" onclick="showTab('health')">${picks > 0 ? `Why only ${picks}?` : "Why none?"}</button>
    </div>
    <div class="ctx-facts">${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</div>
  </div>`;
}

function renderActNow(dashboard: AdminDashboard): string {
  if (dashboard.recommendedEvents.length === 0) {
    const fallback = dashboard.reviewCandidates.length;
    return emptyState(
      "Nothing cleared the bar in the latest scan",
      fallback
        ? `That is normal on a quiet day. ${fallback} near ${plural(fallback, "miss", "misses")} scored ${reviewBand(dashboard)} and may still be worth a look.`
        : "That is normal on a quiet day. Open the Health tab to see why candidates were dropped before scoring.",
      fallback
        ? `<button type="button" class="primary" onclick="showSegment('maybe')">See the ${fallback} near ${plural(fallback, "miss", "misses")}</button>`
        : `<button type="button" class="primary" onclick="showTab('health')">Check scout health</button>`
    );
  }

  return `<div class="cards">${dashboard.recommendedEvents
    .map((item) => {
      const score = item.recommendation.score;
      return eventCard(toCardModel({
        thresholds: dashboard.thresholds,
        eventId: item.recommendation.eventId,
        event: item.event,
        scoreDetail: item.score,
        score,
        action: item.score?.nextAction ?? actionFromScore(score, dashboard.thresholds),
        reasonLabel: "Why the scout picked this",
        reason: item.score?.rationale || item.recommendation.reason,
        fallbackTitle: item.recommendation.eventId
      }));
    })
    .join("")}</div>`;
}

function renderWorthALook(dashboard: AdminDashboard): string {
  if (dashboard.reviewCandidates.length === 0) {
    return emptyState(
      "No near misses right now",
      `Nothing landed in the ${reviewBand(dashboard)} band in the latest scan. Anything the scout scored ${dashboard.thresholds.recommend} or above is on the Act now list.`
    );
  }

  return `<div class="cards">${dashboard.reviewCandidates
    .map((item) => eventCard(toCardModel({
      thresholds: dashboard.thresholds,
      eventId: item.event.id,
      event: item.event,
      scoreDetail: item.score,
      score: resolveScore(item.score, item.event),
      action: item.score.nextAction ?? "monitor",
      reasonLabel: "Why it fell short",
      reason: item.reason || item.score.rationale || "Scored below the recommendation threshold.",
      fallbackTitle: item.event.title
    })))
    .join("")}</div>`;
}

function renderHidden(dashboard: AdminDashboard): string {
  if (dashboard.suppressedEvents.length === 0) {
    return emptyState(
      "Nothing was held back",
      "Every event that cleared the bar in the latest scan is on the Act now list."
    );
  }

  return `<div class="cards">${dashboard.suppressedEvents
    .map((item) => eventCard(toCardModel({
      thresholds: dashboard.thresholds,
      eventId: item.event.id,
      event: item.event,
      scoreDetail: item.score,
      score: resolveScore(item.score, item.event),
      reasonLabel: "Why it is hidden",
      reason: item.reason,
      footnote: item.previousRecommendation
        ? `Already recommended to you on ${formatDateTime(item.previousRecommendation.createdAt)}.`
        : undefined,
      fallbackTitle: item.event.title
    })))
    .join("")}</div>`;
}

function reviewBand(dashboard: AdminDashboard): string {
  return `${dashboard.thresholds.review}-${dashboard.thresholds.recommend - 1}`;
}

function toCardModel(input: {
  thresholds: AdminDashboard["thresholds"];
  eventId: string;
  event?: EventCandidate;
  scoreDetail?: EventScore;
  score: number;
  action?: string;
  reasonLabel: string;
  reason: string;
  footnote?: string;
  fallbackTitle: string;
}): EventCardModel {
  return {
    eventId: input.eventId,
    title: input.event?.title ?? input.fallbackTitle,
    href: input.event?.canonicalUrl,
    startAt: input.event?.startAt,
    where: whereText(input.event),
    score: input.score,
    thresholds: input.thresholds,
    action: input.action,
    reasonLabel: input.reasonLabel,
    reason: input.reason,
    footnote: input.footnote,
    event: input.event,
    scoreDetail: input.scoreDetail
  };
}

function resolveScore(score: EventScore, event: EventCandidate): number {
  return score.totalScore ?? score.score ?? event.score ?? 0;
}

/* -------------------------------------------------------------- History --- */

function renderHistoryTab(dashboard: AdminDashboard): string {
  if (dashboard.recommendationHistory.length === 0) {
    return `<section class="section">
      ${sectionHead(
        "Everything the scout has sent",
        "A running log of past recommendations, newest first. Check here before you share an event so the team does not double up."
      )}
      ${emptyState("No recommendations yet", "Once a scan produces its first pick, it will show up here permanently.")}
    </section>`;
  }

  let lastDate = "";
  const rows = dashboard.recommendationHistory.slice(0, 50).map((item) => {
    const date = formatDateOnly(item.recommendation.createdAt);
    const group = date === lastDate ? "" : `<tr class="group"><td colspan="5">${escapeHtml(date)}</td></tr>`;
    lastDate = date;
    const title = item.event?.title ?? item.recommendation.eventId;
    const action = item.score?.nextAction ?? actionFromScore(item.recommendation.score, dashboard.thresholds);
    return `${group}<tr>
      <td>${item.event?.canonicalUrl ? link(title, item.event.canonicalUrl) : escapeHtml(title)}</td>
      <td>${escapeHtml(item.event?.startAt ? formatDateTime(item.event.startAt) : "Date unknown")}</td>
      <td class="num">${Math.round(item.recommendation.score)}</td>
      <td>${escapeHtml(actionLabel(action))}</td>
      <td class="muted">${escapeHtml(item.recommendation.reason)}</td>
    </tr>`;
  }).join("");

  return `<section class="section">
    ${sectionHead(
      "Everything the scout has sent",
      "A running log of past recommendations, newest first. Check here before you share an event so the team does not double up.",
      dashboard.recommendationHistory.length
    )}
    ${tableWrap(["Event", "Happens", "Score", "Suggested action", "Why it was sent"], rows)}
  </section>`;
}

/* --------------------------------------------------------------- Health --- */

function renderHealthTab(dashboard: AdminDashboard): string {
  return `<div class="banner banner-${dashboard.health.status === "healthy" ? "info" : "warning"}">${escapeHtml(dashboard.health.message)}</div>
  <section class="section">
    ${sectionHead(
      "Recent scans",
      "One row per scheduled run. If Today looks empty, start here: a failed, stuck, or unusually thin run is almost always the reason."
    )}
    ${renderRuns(dashboard)}
  </section>
  <section class="section">
    ${sectionHead(
      "Why candidates were dropped",
      "Links the scout found but never turned into scored events, grouped by the reason it rejected them. A large count next to a reason you disagree with means a filter is too aggressive."
    )}
    ${renderRejectionSummary(dashboard)}
  </section>
  ${renderDataGaps(dashboard, ["run", "candidate", "reject"])}`;
}

function renderRuns(dashboard: AdminDashboard): string {
  const runs = dashboard.runs.slice(0, 6);
  if (runs.length === 0) {
    return emptyState("No scans recorded yet", "Trigger a scan with `pnpm scout:mock` locally, or wait for the next scheduled run.");
  }

  return `<div class="list">${runs.map((run) => {
    const stuck = isRunStuck(run);
    const statusClass = stuck || run.status === "failed"
      ? "status-failing"
      : run.status === "running"
        ? "status-warning"
        : "status-healthy";
    return `<div class="panel runrow">
      <div><span class="status ${statusClass}">${escapeHtml(stuck ? "Stuck" : titleCase(run.status))}</span></div>
      <div class="body">
        <h3>${escapeHtml(titleCase(run.runType))} scan · ${escapeHtml(formatDateTime(run.startedAt))}</h3>
        <div class="chips">
          <span>${escapeHtml(formatDuration(run))}</span>
          <span>${escapeHtml(run.stats.scanMode)} scan</span>
          <span>X ${run.stats.xEnabled ? `on · ${run.stats.xPostsRead} posts read · ${run.stats.xBudgetRemaining} left` : "off"}</span>
          ${run.stats.extractionStoppedByTimeBudget || run.stats.scoringStoppedByTimeBudget ? `<span>stopped early: time limit</span>` : ""}
        </div>
        ${run.error ? `<div class="banner banner-warning">${escapeHtml(run.error)}</div>` : ""}
        <div class="kv">
          ${kv("Links found", run.stats.candidatesFound)}
          ${kv("Dropped", run.stats.rejectedCandidates)}
          ${run.stats.extractionCandidatesAttempted === undefined
            ? kv("Pages read", run.stats.pagesInspected)
            : kv("Pages read", `${run.stats.extractionCandidatesAttempted} of ${run.stats.extractionCandidatesLimit ?? run.stats.extractionCandidatesAttempted}`)}
          ${run.stats.extractionConcurrency ? kv("In parallel", `${run.stats.extractionConcurrency} at a time`) : ""}
          ${kv("Events parsed", run.stats.eventsExtracted)}
          ${kv("Events scored", run.stats.scoresCreated)}
          ${kv("Recommended", run.stats.recommendationsCreated)}
        </div>
      </div>
    </div>`;
  }).join("")}</div>`;
}

function renderRejectionSummary(dashboard: AdminDashboard): string {
  if (dashboard.rejectionSummary.length === 0) {
    return emptyState("No rejection data from the latest scan", "Either nothing was rejected, or the scan has not stored rejection reasons yet.");
  }

  return `<div class="tiles">${dashboard.rejectionSummary.map((item) => `<div class="tile">
    <span class="big">${item.count}</span>
    <h3>${escapeHtml(item.label)}</h3>
    <p class="cap">${escapeHtml(item.description)}</p>
    ${item.examples.length ? `<details class="more">
      <summary>${item.examples.length} ${plural(item.examples.length, "example")}</summary>
      <div class="more-body"><div class="list">${item.examples.map((candidate) => `<div class="listrow">
        <strong>${link(candidate.title ?? candidate.canonicalUrl, candidate.url)}</strong>
        <div class="meta">${escapeHtml(candidate.rejectionReason ?? candidate.snippet ?? "No reason recorded.")}</div>
        <div class="taglist">${tag(candidate.sourcePlatform)}${candidate.sourceQuery ? tag(candidate.sourceQuery) : ""}</div>
      </div>`).join("")}</div></div>
    </details>` : ""}
  </div>`).join("")}</div>`;
}

/* --------------------------------------------------------------- Tuning --- */

function renderTuningTab(dashboard: AdminDashboard): string {
  return `<section class="section">
    ${sectionHead(
      "Who the scout is looking for",
      "These preferences come from the scout profile file. Edit it to change the topics, excluded formats, and score bar; the next scan picks the changes up."
    )}
    ${renderProfileSummary(dashboard)}
  </section>
  <section class="section">
    ${sectionHead(
      "What you have taught the scout",
      "Every button you press on an event card lands here. The scout leans toward what you marked good and away from what you rejected, so a thin list means the scout is still guessing."
    )}
    ${renderTasteSignals(dashboard)}
  </section>
  <section class="section">
    ${sectionHead(
      "Which sources are worth the budget",
      "Each search source or query, and how far its links actually got. Rows marked “Demote or rewrite” burn scan budget without producing events."
    )}
    ${renderSourcePerformance(dashboard)}
  </section>
  <section class="section">
    ${sectionHead(
      "Which hosts run the best rooms",
      "Organizers ranked by the events they produced. A host with a high average score is worth following directly."
    )}
    ${renderOrganizerPerformance(dashboard)}
  </section>
  <section class="section">
    ${sectionHead(
      "Events the scout missed",
      "A weekly sweep looks back for good Bay Area events the daily scans never surfaced. Each row is a blind spot, with a suggestion for closing it."
    )}
    ${renderMissedEvents(dashboard)}
  </section>`;
}

function renderProfileSummary(dashboard: AdminDashboard): string {
  const { profile, thresholds } = dashboard;
  return `<div class="tiles">
    <div class="tile">
      <h3>Profile: ${escapeHtml(profile.name)}</h3>
      <p class="cap">Scouting for ${escapeHtml(profile.persona)}.</p>
    </div>
    <div class="tile">
      <span class="big">${thresholds.recommend}+</span>
      <h3>Recommendation bar</h3>
      <p class="cap">Events scoring ${escapeHtml(reviewBand(dashboard))} land in “Worth a look”.</p>
    </div>
    <div class="tile">
      <h3>Loaded from</h3>
      <p class="cap">${escapeHtml(profile.source)}</p>
    </div>
  </div>`;
}

function renderTasteSignals(dashboard: AdminDashboard): string {
  if (dashboard.feedbackSummary.length === 0 && dashboard.tasteSignals.length === 0) {
    return emptyState(
      "No feedback captured yet",
      "Use the buttons at the bottom of any event card on the Today tab. Even a handful of ratings measurably sharpens the picks.",
      `<button type="button" class="primary" onclick="showTab('today')">Go rate today's events</button>`
    );
  }

  return `<div class="tiles">
    ${dashboard.feedbackSummary.map((item) => `<div class="tile">
      <span class="big">${item.count}</span>
      <h3>${escapeHtml(feedbackLabel(item.feedbackType))}</h3>
      <p class="cap">${item.latestAt ? `Last marked ${escapeHtml(formatDateTime(item.latestAt))}` : "Recorded"}</p>
    </div>`).join("")}
    ${dashboard.tasteSignals.map((signal) => `<div class="tile">
      <h3>Pattern spotted</h3>
      <p class="cap">${escapeHtml(signal)}</p>
    </div>`).join("")}
  </div>`;
}

function renderSourcePerformance(dashboard: AdminDashboard): string {
  if (dashboard.sourcePerformance.length === 0) {
    return `${emptyState("Not enough source data yet", "A few more scans are needed before per-source rates mean anything.")}${renderDataGaps(dashboard, ["source", "query"])}`;
  }

  const rows = dashboard.sourcePerformance.map((row) => `<tr>
    <td><strong>${escapeHtml(row.label)}</strong><div class="muted">${escapeHtml(row.sourceType)}${row.note ? ` · ${escapeHtml(row.note)}` : ""}</div></td>
    <td class="num">${row.candidateCount}</td>
    <td class="num">${row.eventCount}</td>
    <td class="num">${row.recommendationCount}</td>
    <td class="num">${row.noiseCount}</td>
    <td>${escapeHtml(sourceAction(row))}</td>
  </tr>`).join("");

  return `${tableWrap(
    ["Source or query", "Links", "Events", "Recommended", "Noise", "Suggested move"],
    rows
  )}${renderDataGaps(dashboard, ["source", "query"])}`;
}

function renderOrganizerPerformance(dashboard: AdminDashboard): string {
  if (dashboard.organizerPerformance.length === 0) {
    return `${emptyState("Not enough organizer data yet", "Organizers appear here once the scout has parsed a few events that name a host.")}${renderDataGaps(dashboard, ["organizer", "host"])}`;
  }

  const rows = dashboard.organizerPerformance.map((row) => `<tr>
    <td><strong>${escapeHtml(row.organizer)}</strong></td>
    <td class="num">${row.eventCount}</td>
    <td class="num">${row.recommendationCount}</td>
    <td class="num">${Math.round(row.maxScore)}</td>
    <td class="num">${Math.round(row.avgScore)}</td>
  </tr>`).join("");

  return `${tableWrap(["Organizer or host", "Events", "Recommended", "Best score", "Average score"], rows)}${renderDataGaps(dashboard, ["organizer", "host"])}`;
}

function renderMissedEvents(dashboard: AdminDashboard): string {
  if (dashboard.missedEvents.length === 0) {
    const missRun = dashboard.runs.find((run) => run.runType === "miss_hunt");
    if (missRun && (missRun.stats.candidatesFound > 0 || missRun.stats.eventsExtracted > 0 || missRun.stats.recommendationsCreated > 0)) {
      const checked = missRun.stats.eventsExtracted || missRun.stats.candidatesFound;
      return `<div class="panel">
        <h3>Last Miss Hunt checked ${escapeHtml(checked)} ${escapeHtml(plural(checked, "candidate"))}</h3>
        <div class="chips"><span>${escapeHtml(formatDateTime(missRun.startedAt))}</span><span>${missRun.stats.recommendationsCreated} missed</span><span>${missRun.stats.rejectedCandidates} ignored</span></div>
      </div>`;
    }
    return `${emptyState("No misses recorded", "The weekly sweep has not flagged anything the daily scans should have caught.")}${renderDataGaps(dashboard, ["miss"])}`;
  }

  return `<div class="list">${dashboard.missedEvents.map((miss) => `<div class="panel runrow">
    <div>${tag(humanize(miss.missReason), "wait")}</div>
    <div class="body">
      <h3>${miss.url ? link(miss.title, miss.url) : escapeHtml(miss.title)}</h3>
      <div class="chips"><span>${escapeHtml(miss.happenedAt ? formatDateTime(miss.happenedAt) : "Date unknown")}</span></div>
      ${miss.suggestion ? `<div class="callout"><b>How to catch it next time</b>${escapeHtml(miss.suggestion)}</div>` : ""}
    </div>
  </div>`).join("")}</div>${renderDataGaps(dashboard, ["miss"])}`;
}

function renderDataGaps(dashboard: AdminDashboard, keywords: string[]): string {
  const gaps = dashboard.dataGaps.filter((gap) =>
    keywords.some((keyword) => gap.toLowerCase().includes(keyword.toLowerCase()))
  );
  if (gaps.length === 0) return "";
  return gaps.map((gap) => `<div class="banner banner-info">${escapeHtml(gap)}</div>`).join("");
}

function sourceAction(row: {
  candidateCount: number;
  eventCount: number;
  recommendationCount: number;
  noiseCount: number;
}): string {
  const recommendationRate = row.candidateCount > 0 ? row.recommendationCount / row.candidateCount : 0;
  const eventRate = row.candidateCount > 0 ? row.eventCount / row.candidateCount : 0;
  const noiseRate = row.candidateCount > 0 ? row.noiseCount / row.candidateCount : 0;
  if (row.recommendationCount >= 2 || recommendationRate >= 0.15) return "Keep or promote";
  if (noiseRate >= 0.5 && row.candidateCount >= 5) return "Demote or rewrite";
  if (eventRate === 0 && row.candidateCount >= 5) return "Inspect examples";
  return "Monitor";
}

/* --------------------------------------------------------------- Script --- */

const dashboardScript = `
  const TABS = ['today', 'history', 'health', 'tuning'];

  function showTab(id) {
    if (!TABS.includes(id)) id = TABS[0];
    for (const tabId of TABS) {
      const selected = tabId === id;
      document.getElementById('tab-' + tabId).setAttribute('aria-selected', String(selected));
      document.getElementById('panel-' + tabId).hidden = !selected;
    }
    if (window.location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }
    window.scrollTo({ top: 0 });
  }

  const SEGMENTS = ['act', 'maybe', 'hidden'];

  function showSegment(id) {
    if (!SEGMENTS.includes(id)) id = SEGMENTS[0];
    for (const segmentId of SEGMENTS) {
      const selected = segmentId === id;
      document.getElementById('seg-' + segmentId).setAttribute('aria-pressed', String(selected));
      document.getElementById('segment-' + segmentId).hidden = !selected;
    }
    if (document.getElementById('panel-today').hidden) showTab('today');
  }

  function toggleMoreFeedback(button) {
    const extra = button.closest('.feedback').querySelector('.row + .row');
    if (!extra) return;
    extra.hidden = !extra.hidden;
    button.setAttribute('aria-expanded', String(!extra.hidden));
    button.textContent = extra.hidden ? 'More\\u2026' : 'Fewer';
  }

  async function sendFeedback(button, eventId, feedbackType) {
    const group = button.closest('.feedback');
    const original = button.textContent;
    button.disabled = true;
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: eventId, feedbackType: feedbackType })
      });
      if (!response.ok) throw new Error('request failed');
      for (const other of group.querySelectorAll('button.done')) {
        other.classList.remove('done');
        other.textContent = other.dataset.label || other.textContent;
      }
      button.dataset.label = button.dataset.label || original;
      button.classList.add('done');
      button.textContent = '\\u2713 ' + button.dataset.label;
    } catch (error) {
      button.textContent = 'Could not save \\u2014 retry';
      setTimeout(() => { button.textContent = original; }, 2200);
    } finally {
      button.disabled = false;
    }
  }

  async function copyShareLink(button) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    try {
      await navigator.clipboard.writeText(url.toString());
      button.classList.add('done');
      button.textContent = 'Copied';
    } catch (error) {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => {
      button.classList.remove('done');
      button.textContent = 'Copy link';
    }, 1800);
  }

  showTab((window.location.hash || '').replace('#', '') || 'today');
`;
