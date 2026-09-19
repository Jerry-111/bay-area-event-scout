import type { RawCandidate, SourcePlatform } from "@event-scout/shared";

export type DiscoveryConnector = "exa" | "x" | "luma_seed" | "public_source" | "rss";

export type QueryGroup =
  | "luma"
  | "meetup"
  | "eventbrite"
  | "x"
  | "semantic_web"
  | "linkedin_indexed"
  | "source_discovery"
  | "agent_exploration"
  | "miss_hunt"
  | "luma_seed"
  | "public_source"
  | "rss_feed";

export interface QuerySpec {
  id: string;
  group: QueryGroup;
  connector: DiscoveryConnector;
  text: string;
  maxResults: number;
  recencyDays?: number;
  includeDomains?: string[];
  seedUrls?: string[];
  sourceName?: string;
  sourceType?: SourceType;
  sourceScore?: number;
  maxCandidateLinks?: number;
  notes?: string;
}

export interface CandidateUrl extends RawCandidate {
  runId: string;
  url: string;
  canonicalUrl: string;
  sourceQuery?: string;
  sourceId?: string;
  title: string;
  status: "new" | "fetched" | "extracted" | "rejected" | "error";
  rejectionReason?: string;
  sourceHandle?: string;
  sourceName?: string;
  sourceType?: SourceType;
  sourceScore?: number;
}

export type SourceType =
  | "x_account"
  | "luma_calendar"
  | "organizer_site"
  | "linkedin_indexed_author"
  | "meetup_group"
  | "eventbrite_organizer"
  | "vc_page"
  | "founder_house"
  | "newsletter"
  | "venue"
  | "unknown";

export interface SourceRecord {
  id: string;
  sourceType: SourceType;
  name: string;
  url?: string;
  handle?: string;
  qualityScore: number;
  noiseRate: number;
  freshnessScore: number;
  eventsFoundCount: number;
  recommendedEventsCount: number;
  lastSeenAt: string;
}

export interface SourceEdge {
  id: string;
  runId: string;
  fromSourceId: string;
  toSourceId: string;
  edgeType: "discovered" | "links_to" | "mentions" | "co_occurs";
  weight: number;
  evidenceUrl?: string;
  createdAt: string;
}

export interface QueryRow {
  id: string;
  runId: string;
  queryGroup: QueryGroup;
  connector: DiscoveryConnector;
  queryText: string;
  maxResults: number;
  executedAt: string;
}

export interface DiscoveryRepository {
  insertQueries(rows: QueryRow[]): Promise<void>;
  insertCandidateUrls(rows: CandidateUrl[]): Promise<void>;
  upsertSources(rows: SourceRecord[]): Promise<void>;
  insertSourceEdges(rows: SourceEdge[]): Promise<void>;
  close?(): Promise<void>;
}

export interface DiscoveryRunResult {
  runId: string;
  queries: QueryRow[];
  candidates: CandidateUrl[];
  sources: SourceRecord[];
  sourceEdges: SourceEdge[];
}

export interface ConnectorOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  runContext?: DiscoveryRunContext;
}

export interface DiscoveryRunContext {
  scanMode: "full" | "light";
  scanTime?: string;
  xEnabled: boolean;
  xBudgetRemaining: number;
}

export interface DiscoveryStats {
  xPostsRead: number;
  xBudgetRemaining: number;
  xSkippedReason?: string;
}

export interface DiscoveryCandidatesResult {
  candidates: CandidateUrl[];
  stats: DiscoveryStats;
}

export const WEB_SOURCE_PLATFORM: SourcePlatform = "exa";
