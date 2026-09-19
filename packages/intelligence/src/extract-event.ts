import { createLogger, type AppEnv, type RawCandidate } from "@event-scout/shared";
import { fetchCandidatePage } from "./fetch-page.js";
import { extractEventWithLlm } from "./llm.js";
import type { ExtractedEvent, FetchedPage } from "./schemas.js";

const logger = createLogger("intelligence:extract");

export interface ExtractCandidateInput {
  candidate: RawCandidate;
  page?: FetchedPage;
  env: AppEnv;
  preferFirecrawl?: boolean;
}

export async function extractEventFromCandidate(
  input: ExtractCandidateInput
): Promise<ExtractedEvent | null> {
  const page = input.page ?? (await fetchCandidatePage(
    { candidate: input.candidate, preferFirecrawl: input.preferFirecrawl },
    input.env
  ));
  if (page.status !== "ok") {
    logger.warn("candidate page fetch failed", {
      candidateId: input.candidate.id,
      fetchMethod: page.fetchMethod,
      error: page.error
    });
    return null;
  }

  return extractEventWithLlm({
    candidate: input.candidate,
    page,
    env: input.env
  });
}
