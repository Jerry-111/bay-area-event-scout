import {
  matchesAnyKeyword,
  slugifyLabel,
  type AppEnv,
  type NextAction,
  type ProfileTopic,
  type ScoutProfile
} from "@event-scout/shared";
import { eventHaystack, scoreEventWithLlm } from "./llm.js";
import type { ExtractedEvent, StructuredEventScore } from "./schemas.js";

/** Caps on how far profile topic weights can move a score. */
const MAX_TOPIC_BOOST = 15;
const MAX_TOPIC_PENALTY = 25;

export interface TopicAdjustment {
  boost: number;
  penalty: number;
  boostedTopics: ProfileTopic[];
  penalizedTopics: ProfileTopic[];
}

export async function scoreExtractedEvent(
  event: ExtractedEvent,
  env: AppEnv
): Promise<StructuredEventScore> {
  const profile = env.profile;
  const score = await scoreEventWithLlm({ event, env });
  const componentTotal =
    score.userFit +
    score.roomQuality +
    score.networkingValue +
    score.timeliness +
    score.locationActionability +
    score.novelty +
    score.evidenceConfidence;

  const normalizedTotal = Math.max(0, Math.min(100, Math.round(score.totalScore)));
  const reconciledTotal =
    Math.abs(componentTotal - normalizedTotal) > 3
      ? Math.max(0, Math.min(100, componentTotal - score.penalties.length * 3))
      : normalizedTotal;

  const { boost, penalty, boostedTopics, penalizedTopics } = topicAdjustment(event, profile);
  const userFitPenalty = Math.min(score.userFit, Math.ceil(penalty * 0.45));
  const networkingPenalty = Math.min(score.networkingValue, Math.ceil(penalty * 0.3));
  const noveltyPenalty = Math.min(score.novelty, Math.max(0, penalty - userFitPenalty - networkingPenalty));
  const userFit = Math.min(25, score.userFit - userFitPenalty + Math.ceil(boost * 0.5));
  const networkingValue = Math.min(15, score.networkingValue - networkingPenalty + Math.floor(boost * 0.25));
  const novelty = Math.min(10, score.novelty - noveltyPenalty + Math.max(0, boost - Math.ceil(boost * 0.5) - Math.floor(boost * 0.25)));
  const adjustedTotal = Math.max(0, Math.min(100, reconciledTotal - penalty + boost));
  const rationale = [
    score.rationale,
    ...boostedTopics.map((topic) => `Preferred topic: ${topic.name} (+${topic.weight})`),
    ...penalizedTopics.map((topic) => `Lower-priority topic: ${topic.name} (${topic.weight})`)
  ].join("; ");

  return {
    ...score,
    totalScore: adjustedTotal,
    userFit,
    networkingValue,
    novelty,
    penalties: [...score.penalties, ...penalizedTopics.map((topic) => `lower_priority_topic:${slugifyLabel(topic.name)}`)],
    rationale,
    shouldRecommend: score.shouldRecommend && adjustedTotal >= profile.thresholds.recommend,
    nextAction: resolveNextAction(score.nextAction, adjustedTotal, profile)
  };
}

/**
 * Deterministic nudge from the profile's topic weights: every matching topic adds its weight.
 * Boosts are halved for formats the profile avoids (conferences, courses, ...).
 */
export function topicAdjustment(event: ExtractedEvent, profile: ScoutProfile): TopicAdjustment {
  const haystack = eventHaystack(event);
  const matched = profile.topics.filter((topic) => topic.weight !== 0 && matchesAnyKeyword(haystack, topic.keywords));
  const boostedTopics = matched.filter((topic) => topic.weight > 0);
  const penalizedTopics = matched.filter((topic) => topic.weight < 0);
  const rawBoost = boostedTopics.reduce((sum, topic) => sum + topic.weight, 0);
  const weakFormat = rawBoost > 0 && matchesAnyKeyword(haystack, profile.formats.avoid);
  const boost = Math.min(MAX_TOPIC_BOOST, Math.round(weakFormat ? rawBoost / 2 : rawBoost));
  const penalty = Math.min(MAX_TOPIC_PENALTY, penalizedTopics.reduce((sum, topic) => sum - topic.weight, 0));
  return { boost, penalty, boostedTopics, penalizedTopics };
}

function resolveNextAction(action: NextAction, total: number, profile: ScoutProfile): NextAction {
  if (total >= profile.thresholds.recommend) return action === "skip" ? "rsvp" : action;
  if (total >= profile.thresholds.review) return action === "ask_intro" ? action : "monitor";
  return "skip";
}
