import type { ScoutProfile } from "@event-scout/shared";
import { sourceFromCandidate, stableId } from "./normalize.js";
import type { CandidateUrl, SourceEdge, SourceRecord } from "./types.js";

export function buildSourceGraph(runId: string, candidates: CandidateUrl[], now = new Date(), profile?: ScoutProfile): {
  sources: SourceRecord[];
  sourceEdges: SourceEdge[];
} {
  const sourcesById = new Map<string, SourceRecord>();
  const edgesById = new Map<string, SourceEdge>();
  const createdAt = now.toISOString();

  for (const candidate of candidates) {
    const source = sourceFromCandidate(candidate, profile);
    const existing = sourcesById.get(source.id);
    if (existing) {
      existing.eventsFoundCount += 1;
      existing.qualityScore = Math.round((existing.qualityScore + source.qualityScore) / 2);
      existing.noiseRate = Math.round(((existing.noiseRate + source.noiseRate) / 2) * 100) / 100;
      existing.lastSeenAt = candidate.discoveredAt > existing.lastSeenAt ? candidate.discoveredAt : existing.lastSeenAt;
    } else {
      sourcesById.set(source.id, source);
    }

    const candidateSourceId = stableId(["candidate", candidate.canonicalUrl]);
    const candidateSource: SourceRecord = {
      id: candidateSourceId,
      sourceType: "organizer_site",
      name: candidate.title ?? candidate.canonicalUrl,
      url: candidate.canonicalUrl,
      qualityScore: candidate.sourceScore ?? 50,
      noiseRate: candidate.rejectionReason ? 0.4 : 0.1,
      freshnessScore: 80,
      eventsFoundCount: 1,
      recommendedEventsCount: 0,
      lastSeenAt: candidate.discoveredAt
    };

    if (!sourcesById.has(candidateSource.id)) {
      sourcesById.set(candidateSource.id, candidateSource);
    }

    const edgeType = candidate.sourcePlatform === "x" ? "mentions" : "discovered";
    const edgeId = stableId([runId, source.id, candidateSource.id, edgeType, candidate.canonicalUrl]);
    edgesById.set(edgeId, {
      id: edgeId,
      runId,
      fromSourceId: source.id,
      toSourceId: candidateSource.id,
      edgeType,
      weight: candidate.rejectionReason ? 0.25 : Math.max(0.4, Math.min(1, (candidate.sourceScore ?? 50) / 100)),
      evidenceUrl: candidate.sourceUrl,
      createdAt
    });
  }

  return {
    sources: Array.from(sourcesById.values()),
    sourceEdges: Array.from(edgesById.values())
  };
}
