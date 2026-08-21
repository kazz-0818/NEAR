const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 8;
const READY_BUDGET_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** RITS 無料枠のコールドスタートが終わるまで /health を待つ */
export async function wakeRitsHealth(base: string): Promise<void> {
  const deadline = Date.now() + READY_BUDGET_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return;
    } catch {
      /* still waking */
    }
    await sleep(2_000);
  }
}

async function postAdminJsonWithRetry(
  base: string,
  adminKey: string,
  path: "/admin/logs" | "/admin/usage",
  body: unknown,
): Promise<Response> {
  const url = `${base}${path}`;
  let last: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt === 0) {
      await wakeRitsHealth(base);
    } else {
      await sleep(Math.min(16_000, 1_000 * 2 ** (attempt - 1)));
    }
    last = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-api-key": adminKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (last.ok || !RETRYABLE_STATUSES.has(last.status)) return last;
  }
  return last!;
}

export async function postAdminLogsWithRetry(
  base: string,
  adminKey: string,
  body: unknown,
): Promise<Response> {
  return postAdminJsonWithRetry(base, adminKey, "/admin/logs", body);
}

export async function postAdminUsageWithRetry(
  base: string,
  adminKey: string,
  body: unknown,
): Promise<Response> {
  return postAdminJsonWithRetry(base, adminKey, "/admin/usage", body);
}
