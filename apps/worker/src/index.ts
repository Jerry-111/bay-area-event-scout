import { isMainModule } from "@event-scout/shared";

export { runDailyScout, runScout } from "./jobs/run-scout.js";
export { runMissHunt } from "./jobs/run-miss-hunt.js";
export {
  dailyScoutSchedules,
  scoutDaily,
  scoutDailyNineAm,
  scoutDailyNineAmTask,
  scoutDailyTwoPm,
  scoutDailyTwoPmTask,
  scoutDailyTenPm,
  scoutDailyTenPmTask
} from "./trigger/scout-daily.js";
export { missHuntWeekly, missHuntWeeklyTask, weeklyMissHuntSchedule } from "./trigger/miss-hunt-weekly.js";

if (isMainModule(import.meta.url)) {
  const command = process.argv[2] ?? "scout";
  if (command === "miss-hunt") {
    const { runMissHunt } = await import("./jobs/run-miss-hunt.js");
    await runMissHunt();
  } else {
    const { runDailyScout } = await import("./jobs/run-scout.js");
    await runDailyScout({ runType: command === "daily" ? "daily" : "manual" });
  }
}
