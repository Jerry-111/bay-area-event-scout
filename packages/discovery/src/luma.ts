import type { AppEnv } from "@event-scout/shared";
import { classifyRejectionReason, normalizeCandidateUrl, scoreCandidateSignal, stableId } from "./normalize.js";
import type { CandidateUrl, ConnectorOptions, QuerySpec } from "./types.js";

export async function runLumaSeedRefresh(
  runId: string,
  queryPack: QuerySpec[],
  env: AppEnv,
  options: ConnectorOptions = {}
): Promise<CandidateUrl[]> {
  const now = options.now ?? new Date();
  const profile = env.profile;
  const seedQueries = queryPack.filter((query) => query.connector === "luma_seed");
  const seedUrls = seedQueries.flatMap((query) => query.seedUrls ?? []).slice(0, Math.max(0, env.budgets.maxExaSearchesPerRun));

  return seedUrls.map((url) => {
    const canonicalUrl = normalizeCandidateUrl(url);
    const title = `Luma public surface: ${new URL(canonicalUrl).pathname.split("/").filter(Boolean).join("/") || "home"}`;
    const snippet = "Public Luma URL seed retained for Exa and downstream extraction. No logged-in access is used.";
    const rejectionReason = classifyRejectionReason({ canonicalUrl, title, snippet }, { now, profile }) ?? "luma_calendar_seed_not_event";
    return {
      id: stableId([runId, "luma-seed", canonicalUrl]),
      runId,
      sourcePlatform: "luma",
      sourceUrl: canonicalUrl,
      url,
      canonicalUrl,
      sourceQuery: "luma_public_seed",
      title,
      snippet,
      discoveredAt: now.toISOString(),
      evidence: ["public luma seed"],
      status: "rejected",
      rejectionReason,
      sourceType: "luma_calendar",
      sourceScore: scoreCandidateSignal({ canonicalUrl, title, snippet }, profile)
    };
  });
}
