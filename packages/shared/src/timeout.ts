/**
 * Generic promise timeout used by `pnpm doctor --live`'s cheap connectivity checks (LLM, Exa,
 * Telegram, Postgres). Distinct from `fetchWithTimeout`, which is specific to `fetch`'s
 * `AbortController` signal; this wraps any promise, e.g. an SDK call or a `pg` query.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!(timeoutMs > 0)) return promise;

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
