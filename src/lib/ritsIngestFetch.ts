const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** RITS 無料枠スリープ解除（ingest 前） */
export async function wakeRitsHealth(base: string): Promise<void> {
  try {
    await fetch(`${base}/health`, { signal: AbortSignal.timeout(12_000) });
  } catch {
    /* ignore */
  }
}

export async function postAdminLogsWithRetry(
  base: string,
  adminKey: string,
  body: unknown,
): Promise<Response> {
  const url = `${base}/admin/logs`;
  let last: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(500 * attempt);
    } else {
      await wakeRitsHealth(base);
    }
    last = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-api-key": adminKey,
      },
      body: JSON.stringify(body),
    });
    if (last.ok || !RETRYABLE_STATUSES.has(last.status)) return last;
  }
  return last!;
}
