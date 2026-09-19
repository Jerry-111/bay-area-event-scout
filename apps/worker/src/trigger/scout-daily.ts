import { loadRuntimeEnv } from "@event-scout/shared";
import { schedules } from "@trigger.dev/sdk";
import { runDailyScout } from "../jobs/run-scout.js";

export const dailyScoutSchedules = [
  {
    id: "daily-scout-9am-pt",
    cron: "0 9 * * *",
    timezone: "America/Los_Angeles",
    scanTime: "09:00",
    scanMode: "full"
  },
  {
    id: "daily-scout-2pm-pt",
    cron: "0 14 * * *",
    timezone: "America/Los_Angeles",
    scanTime: "14:00",
    scanMode: "light"
  },
  {
    id: "daily-scout-10pm-pt",
    cron: "0 22 * * *",
    timezone: "America/Los_Angeles",
    scanTime: "22:00",
    scanMode: "light"
  }
] as const;

export async function scoutDaily(): Promise<void> {
  await runDailyScout({ runType: "daily", scanTime: "09:00" });
}

export async function scoutDailyNineAm(): Promise<void> {
  await runScheduledScan("09:00");
}

export async function scoutDailyTwoPm(): Promise<void> {
  await runScheduledScan("14:00");
}

export async function scoutDailyTenPm(): Promise<void> {
  await runScheduledScan("22:00");
}

/**
 * Runs one of the fixed daily schedules, unless SCAN_SCHEDULES leaves its time out: that is how a
 * deployment scans once or twice a day instead of three times without redeploying.
 */
async function runScheduledScan(scanTime: string): Promise<void> {
  const env = loadRuntimeEnv();
  if (!env.scanSchedules.includes(scanTime)) {
    console.log(`Skipping the ${scanTime} scan: it is not in SCAN_SCHEDULES (${env.scanSchedules.join(", ")}).`);
    return;
  }
  await runDailyScout({ runType: "daily", scanTime, env });
}

export const scoutDailyNineAmTask = schedules.task({
  id: "daily-scout-9am-pt",
  cron: {
    pattern: "0 9 * * *",
    timezone: "America/Los_Angeles"
  },
  run: async () => {
    await scoutDailyNineAm();
  }
});

export const scoutDailyTwoPmTask = schedules.task({
  id: "daily-scout-2pm-pt",
  cron: {
    pattern: "0 14 * * *",
    timezone: "America/Los_Angeles"
  },
  run: async () => {
    await scoutDailyTwoPm();
  }
});

export const scoutDailyTenPmTask = schedules.task({
  id: "daily-scout-10pm-pt",
  cron: {
    pattern: "0 22 * * *",
    timezone: "America/Los_Angeles"
  },
  run: async () => {
    await scoutDailyTenPm();
  }
});
