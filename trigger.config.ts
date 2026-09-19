import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_replace_with_your_project_ref",
  dirs: ["./apps/worker/src/trigger"],
  runtime: "node-22",
  maxDuration: 1800,
  build: {
    // Ship the scout profiles with the deployed tasks. Select one with the SCOUT_PROFILE
    // environment variable in Trigger.dev, or deploy with a scout.profile.yaml at the repo root.
    extensions: [additionalFiles({ files: ["./profiles/*.yaml", "./scout.profile.yaml"] })]
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
      randomize: true
    }
  }
});
