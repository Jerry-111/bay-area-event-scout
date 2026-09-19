/**
 * Small, dependency-free `--flag value` parser shared by the onboarding wizard, `pnpm doctor`,
 * and `pnpm profile:new`, so their non-interactive/scripted modes are simple and unit-testable.
 */

export type FlagType = "string" | "boolean";
export type FlagSpec = Record<string, FlagType>;
export type FlagValues = Record<string, string | boolean>;

export interface ParsedFlags {
  flags: FlagValues;
  positionals: string[];
}

export class CliFlagError extends Error {}

/**
 * Parses `--flag value`, `--flag=value`, and boolean `--flag` switches against `spec`.
 * Everything else (and everything after a bare `--`) is returned as a positional argument.
 * Throws `CliFlagError` for an unknown flag, a boolean flag given a value, or a string flag
 * given none.
 */
export function parseFlags(argv: readonly string[], spec: FlagSpec): ParsedFlags {
  const flags: FlagValues = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const name = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const type = spec[name];
    if (!type) {
      throw new CliFlagError(
        `Unknown flag --${name}. Supported flags: ${Object.keys(spec).map((key) => `--${key}`).join(", ")}`
      );
    }

    if (type === "boolean") {
      if (equalsIndex !== -1) {
        throw new CliFlagError(`--${name} does not take a value`);
      }
      flags[name] = true;
      continue;
    }

    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined) {
      throw new CliFlagError(`--${name} requires a value`);
    }
    if (inlineValue === undefined) index += 1;
    flags[name] = value;
  }

  return { flags, positionals };
}

export function stringFlag(flags: FlagValues, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function booleanFlag(flags: FlagValues, name: string): boolean {
  return flags[name] === true;
}

/** What `npm start` (scripts/start.mjs) calls each of these package scripts. */
const LAUNCHER_ACTIONS: Record<string, string> = {
  onboard: "setup",
  "scout:doctor": "doctor",
  "scout:real": "scan",
  admin: "dashboard",
  "profile:show": "preferences",
  "profile:edit": "preferences",
  "profile:new": "preferences",
  "profile:undo": "undo"
};

/**
 * How to tell someone to run one of this repo's commands, e.g. `pnpm onboard`. People who came in
 * through `npm start` (which sets SCOUT_LAUNCHER=npm-start for the scripts it runs) may not have
 * pnpm on their PATH, so they get the launcher's version instead: `npm start setup`.
 */
export function commandHint(script: string, args?: string, env: NodeJS.ProcessEnv = process.env): string {
  const action = env.SCOUT_LAUNCHER === "npm-start" ? LAUNCHER_ACTIONS[script] : undefined;
  if (action) return `npm start ${action}`;
  return args ? `pnpm ${script} ${args}` : `pnpm ${script}`;
}
