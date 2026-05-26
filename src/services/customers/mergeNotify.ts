import { pushText } from "../../channels/line/client.js";
import { getEnv } from "../../config/env.js";
import { getEffectivePublicBaseUrl } from "../../lib/renderRuntime.js";
import { getLogger } from "../../lib/logger.js";
import type { Db } from "../../db/client.js";
import { listMergeCandidates } from "../supabase/repositories/customerMergeCandidates.js";

function resolveNotifyTo(): string | null {
  const env = getEnv();
  if (env.VELIORA_MERGE_CANDIDATE_NOTIFY === false) return null;
  if (env.GROWTH_APPROVAL_GROUP_ID?.trim()) return env.GROWTH_APPROVAL_GROUP_ID.trim();
  if (env.ADMIN_LINE_USER_ID?.trim()) return env.ADMIN_LINE_USER_ID.trim();
  return null;
}

/** 新規 pending 候補ができたときのみ（非同期・失敗はログのみ） */
export async function notifyMergeCandidateCreated(
  db: Db,
  input: { candidateId: string; reason: string }
): Promise<void> {
  const to = resolveNotifyTo();
  if (!to) return;
  const log = getLogger();
  try {
    const pending = await listMergeCandidates(db, "pending");
    const base = getEffectivePublicBaseUrl();
    const ui = base ? `${base}/admin/ui` : "/admin/ui";
    const body = [
      "【Veliora】顧客マスター: 手動 merge 候補が追加されました",
      `理由: ${input.reason}`,
      `候補ID: ${input.candidateId.slice(0, 8)}…`,
      `pending 合計: ${pending.length} 件`,
      `管理: ${ui}`,
      "※ 自動 merge はしません。管理 UI で survivor を選んで承認してください。",
    ].join("\n");
    await pushText(to, body.slice(0, 4800));
  } catch (e) {
    log.warn({ err: e, candidateId: input.candidateId }, "notifyMergeCandidateCreated failed");
  }
}
