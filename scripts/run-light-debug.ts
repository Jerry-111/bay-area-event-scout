process.env.MOCK_MODE ??= "false";
process.env.MAX_X_POSTS_PER_RUN ??= "0";

const startedAt = Date.now();
const { runDailyScout } = await import("../apps/worker/src/jobs/run-scout.js");
const stats = await runDailyScout({ runType: "manual", scanTime: "14:00" });

console.log(JSON.stringify({ durationMs: Date.now() - startedAt, stats }, null, 2));
