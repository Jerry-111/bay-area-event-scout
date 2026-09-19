import type {
  CandidateUrl,
  EventCandidate,
  EventScore,
  FeedbackType,
  Recommendation,
  RunStats,
  RunType,
  ScoutRun,
  SourcePlatform
} from "@event-scout/shared";

export interface EventStore {
  createRun(runType: RunType): Promise<ScoutRun>;
  finishRun(runId: string, stats: RunStats): Promise<void>;
  failRun(runId: string, error: unknown, stats?: Partial<RunStats>): Promise<void>;
  saveCandidateUrls(runId: string, candidates: CandidateUrl[]): Promise<void>;
  saveCandidates(candidates: CandidateUrl[]): Promise<void>;
  saveEvents(events: EventCandidate[]): Promise<void>;
  saveEventSources?(links: EventSourceLink[]): Promise<void>;
  saveEventScores(runId: string, scores: EventScore[]): Promise<void>;
  saveRecommendations(runId: string, recommendations: Recommendation[]): Promise<void>;
  saveMissHuntResult?(input: SaveMissHuntResultInput): Promise<void>;
  listRuns(limit?: number): Promise<ScoutRun[]>;
  listCandidateUrls(options?: { runId?: string; status?: string; limit?: number }): Promise<CandidateUrl[]>;
  listEvents(options?: { runId?: string; limit?: number }): Promise<EventCandidate[]>;
  listEventScores(options?: { runId?: string; limit?: number }): Promise<EventScore[]>;
  listRecommendations(options?: { runId?: string; limit?: number }): Promise<Recommendation[]>;
  createFeedback(input: { eventId: string; feedbackType: FeedbackType; note?: string }): Promise<void>;
  getDashboard(): Promise<AdminDashboard>;
  close?(): Promise<void>;
}

export interface EventSourceLink {
  eventId: string;
  candidateUrlId: string;
  sourcePlatform: SourcePlatform;
}

export interface AdminDashboard {
  runs: ScoutRun[];
  candidateCounts: Record<string, number>;
  topRecommendations: Recommendation[];
  rejectedCandidates: CandidateUrl[];
  events: EventCandidate[];
  scores: EventScore[];
  today: DashboardToday;
  health: DashboardHealth;
  recommendedEvents: DashboardRecommendation[];
  recommendationHistory: DashboardRecommendation[];
  suppressedEvents: DashboardSuppressedEvent[];
  reviewCandidates: DashboardReviewCandidate[];
  rejectionSummary: DashboardRejectionSummary[];
  sourcePerformance: DashboardSourcePerformance[];
  organizerPerformance: DashboardOrganizerPerformance[];
  feedbackSummary: DashboardFeedbackSummary[];
  tasteSignals: string[];
  missedEvents: DashboardMissedEvent[];
  dataGaps: string[];
  /** Score bands from the active scout profile. */
  thresholds: { recommend: number; review: number };
  /** The active scout profile, so the team can see which preferences produced this list. */
  profile: { name: string; source: string; persona: string };
}

export interface FeedbackRow {
  id: string;
  eventId: string;
  feedbackType: FeedbackType;
  note?: string;
  createdAt: string;
}

export interface DashboardToday {
  /** The run whose results Today shows (see dashboardDisplayRun). */
  latestRunId?: string;
  latestRunStatus?: string;
  /** A newer scan that is still running, while Today keeps showing the last finished one. */
  activeRunId?: string;
  activeRunStartedAt?: string;
  nextScheduledScan?: string;
  scanMode: string;
  xPostsUsedToday: number;
  xDailyBudget: number;
  candidateCount: number;
  eventCount: number;
  recommendationCount: number;
  warning?: string;
}

export interface DashboardHealth {
  status: "healthy" | "warning" | "failing";
  message: string;
}

export interface DashboardRecommendation {
  recommendation: Recommendation;
  event?: EventCandidate;
  score?: EventScore;
}

export interface DashboardSuppressedEvent {
  event: EventCandidate;
  score: EventScore;
  reason: string;
  previousRecommendation?: Recommendation;
}

export interface DashboardReviewCandidate {
  event: EventCandidate;
  score: EventScore;
  reason: string;
}

export interface DashboardRejectionSummary {
  key: string;
  label: string;
  count: number;
  description: string;
  examples: CandidateUrl[];
}

export interface DashboardSourcePerformance {
  label: string;
  sourceType: string;
  candidateCount: number;
  eventCount: number;
  recommendationCount: number;
  noiseCount: number;
  note?: string;
}

export interface DashboardOrganizerPerformance {
  organizer: string;
  eventCount: number;
  recommendationCount: number;
  maxScore: number;
  avgScore: number;
}

export interface DashboardFeedbackSummary {
  feedbackType: FeedbackType;
  count: number;
  latestAt?: string;
}

export interface DashboardMissedEvent {
  id: string;
  title: string;
  url?: string;
  happenedAt?: string;
  missReason: string;
  suggestion?: string;
  createdAt: string;
}

export interface SaveMissHuntResultInput {
  runId: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  summary: Record<string, unknown>;
  missedEvents: Array<{
    title: string;
    url?: string;
    happenedAt?: string;
    missReason: string;
    evidence: unknown[];
    suggestion?: string;
  }>;
}
