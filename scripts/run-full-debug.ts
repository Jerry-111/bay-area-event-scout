process.env.MOCK_MODE ??= "false";

const startedAt = Date.now();
const { runDailyScout } = await import("../apps/worker/src/jobs/run-scout.js");
const stats = await runDailyScout({ runType: "manual", scanTime: "09:00" });

console.log(JSON.stringify({ durationMs: Date.now() - startedAt, stats }, null, 2));
