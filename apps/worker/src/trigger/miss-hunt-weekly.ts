import { schedules } from "@trigger.dev/sdk";
import { runMissHunt } from "../jobs/run-miss-hunt.js";

export const weeklyMissHuntSchedule = {
  id: "weekly-miss-hunt-sunday-6pm-pt",
  cron: "0 18 * * 0",
  timezone: "America/Los_Angeles"
} as const;

export async function missHuntWeekly(): Promise<void> {
  await runMissHunt();
}

export const missHuntWeeklyTask = schedules.task({
  id: "weekly-miss-hunt-sunday-6pm-pt",
  cron: {
    pattern: "0 18 * * 0",
    timezone: "America/Los_Angeles"
  },
  run: async () => {
    await missHuntWeekly();
  }
});
