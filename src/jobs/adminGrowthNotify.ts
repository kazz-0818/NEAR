import { pushText } from "../channels/line/client.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";

const LINE_TEXT_MAX = 4800;

/**
 * 同一 fingerprint について 24h に1回まで管理者へプッシュ（クールダウン）。
 * 提案レコード自体は別ロジックで作成済みであること。
 */
export async function notifyAdminNewSuggestion(input: {
  db: Db;
  messageFingerprint: string;
  suggestionId: number;
  summary: string;
  difficulty: string | null;
}): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  if (!env.ADMIN_LINE_USER_ID) return;

  try {
    const recent = await input.db.query(
      `SELECT 1 FROM admin_notify_log
       WHERE message_fingerprint = $1 AND notified_at > now() - interval '24 hours'
       LIMIT 1`,
      [input.messageFingerprint]
    );
    if (recent.rows.length > 0) {
      log.info({ fingerprint: input.messageFingerprint }, "admin notify skipped (cooldown)");
      return;
    }

    const adminBase = env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}/admin` : null;
    const lines = [
      "【NEAR】新しい実装提案があります",
      `suggestion id: ${input.suggestionId}`,
      "",
      input.summary.slice(0, 400),
      "",
      input.difficulty ? `難易度: ${input.difficulty}` : "",
      adminBase ? `管理API: ${adminBase}/suggestions/${input.suggestionId}` : "GET /admin/suggestions で確認し、PATCH で承認してください",
    ].filter((x) => x !== "");

    let body = lines.join("\n");
    if (body.length > LINE_TEXT_MAX) {
      body = body.slice(0, LINE_TEXT_MAX - 20) + "\n…(省略)";
    }

    await pushText(env.ADMIN_LINE_USER_ID, body);
    await input.db.query(`INSERT INTO admin_notify_log (message_fingerprint) VALUES ($1)`, [
      input.messageFingerprint,
    ]);
  } catch (e) {
    log.warn({ err: e }, "admin growth notify failed");
  }
}
