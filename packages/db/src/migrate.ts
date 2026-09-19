import { loadRuntimeEnv } from "@event-scout/shared";
import { runMigrations } from "./index.js";

const env = loadRuntimeEnv();
await runMigrations(env);
