import { classifyMissedEventWithLlm, type MissHuntInput } from "./llm.js";
import type { MissHuntClassification } from "./schemas.js";

/** Keeps miss-hunt LLM calls within typical provider rate limits. */
const MISS_HUNT_CONCURRENCY = 4;

export interface WeeklyMissHuntResult {
  checked: number;
  missed: MissHuntClassification[];
  ignored: MissHuntClassification[];
}

export async function classifyWeeklyMissHunt(
  inputs: MissHuntInput[]
): Promise<WeeklyMissHuntResult> {
  const classifications = await mapWithConcurrency(inputs, MISS_HUNT_CONCURRENCY, (input) =>
    classifyMissedEventWithLlm(input)
  );
  return {
    checked: classifications.length,
    missed: classifications.filter((item) => item.wasMissed),
    ignored: classifications.filter((item) => !item.wasMissed)
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
