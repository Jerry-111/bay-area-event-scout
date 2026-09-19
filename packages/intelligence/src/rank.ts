import type { StructuredEventScore } from "./schemas.js";

export interface RankedEvent<TEvent> {
  event: TEvent;
  score: StructuredEventScore;
  rank: number;
}

export function rankEvents<TEvent extends { startAt?: string; confidence?: number }>(
  scoredEvents: Array<{ event: TEvent; score: StructuredEventScore }>,
  limit: number
): Array<RankedEvent<TEvent>> {
  return scoredEvents
    .filter(({ score }) => score.shouldRecommend)
    .sort((left, right) => compareScoredEvents(left, right))
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

function compareScoredEvents<TEvent extends { startAt?: string; confidence?: number }>(
  left: { event: TEvent; score: StructuredEventScore },
  right: { event: TEvent; score: StructuredEventScore }
): number {
  const scoreDelta = right.score.totalScore - left.score.totalScore;
  if (scoreDelta !== 0) return scoreDelta;

  const confidenceDelta = (right.event.confidence ?? 0) - (left.event.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;

  return timestamp(left.event.startAt) - timestamp(right.event.startAt);
}

function timestamp(value: string | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
