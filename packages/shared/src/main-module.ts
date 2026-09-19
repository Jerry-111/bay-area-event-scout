import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when the module at `moduleUrl` (pass `import.meta.url`) is the script Node was started
 * with. Compares resolved file paths rather than `file://${process.argv[1]}` strings, which never
 * match on Windows (`C:\...` vs `file:///C:/...`) or when the folder name contains a space (`%20`).
 */
export function isMainModule(moduleUrl: string, entryPath: string | undefined = process.argv[1]): boolean {
  if (!entryPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}
