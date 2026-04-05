import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import {
  handleAdminAffirmativeFinalApproval,
  handleAdminGrowthComplete,
  handleAdminNegativeFinalApproval,
  resolveSuggestionIdForAdmin,
} from "./growth_orchestrator.js";
import { setImplementationState } from "./approval_service.js";
import { notifyProgress } from "./admin_notification_service.js";
import { getEnv } from "../config/env.js";

const log = getLogger();

function norm(s: string): string {
  return s.normalize("NFKC").trim();
}

function parseExplicitSuggestionId(text: string): number | null {
  const m = text.match(/#?\s*(\d{1,12})\s*$/);
  if (m?.[1]) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  const lead = text.match(/^\s*#(\d{1,12})\b/);
  if (lead?.[1]) return Number(lead[1]);
  return null;
}

function isAffirmative(text: string): boolean {
  const t = norm(text).toLowerCase();
  return /^(はい|イエス|yes|ok|okay|お願いします|承認|よろしく|👍)/i.test(t);
}

function isNegative(text: string): boolean {
  const t = norm(text).toLowerCase();
  return /^(いいえ|イイエ|no|だめ|ダメ|見送り|やめ|キャンセル)/i.test(t);
}

/**
 * 管理者の LINE テキストを成長フローが処理すべきか判定し、処理する。
 * 第一段階・ヒアリングは依頼ユーザー側のため、ここでは最終承認以降のみ。
 */
export async function tryHandleAdminGrowthLine(input: {
  db: Db;
  adminUserId: string;
  text: string;
}): Promise<{ handled: boolean; reply: string }> {
  const env = getEnv();
  if (!env.ADMIN_LINE_USER_ID || input.adminUserId !== env.ADMIN_LINE_USER_ID) {
    return { handled: false, reply: "" };
  }

  const raw = input.text;
  const text = norm(raw);
  if (!text) return { handled: false, reply: "" };

  const explicitId = parseExplicitSuggestionId(text);
  const suggestionId = await resolveSuggestionIdForAdmin(input.db, input.adminUserId, text, explicitId);
  if (suggestionId == null) {
    return { handled: false, reply: "" };
  }

  const row = await input.db.query<{
    approval_status: string;
    implementation_state: string;
  }>(`SELECT approval_status, implementation_state FROM implementation_suggestions WHERE id = $1`, [suggestionId]);

  if (row.rows.length === 0) return { handled: false, reply: "" };
  const { approval_status: ap, implementation_state: st } = row.rows[0]!;

  if (isNegative(text) && ap === "pending" && st === "awaiting_final_approval") {
    const reply = await handleAdminNegativeFinalApproval(input.db, input.adminUserId, suggestionId);
    return { handled: true, reply };
  }

  if (isAffirmative(text) && ap === "pending" && st === "awaiting_final_approval") {
    const reply = await handleAdminAffirmativeFinalApproval(input.db, input.adminUserId, suggestionId);
    return { handled: true, reply };
  }

  if (/(成長完了|せいちょうかんりょう)/.test(text)) {
    if (["coding", "testing", "deploy_candidate_ready", "deploying"].includes(st)) {
      const reply = await handleAdminGrowthComplete(input.db, input.adminUserId, suggestionId);
      return { handled: true, reply };
    }
    return { handled: true, reply: "いまの状態では「成長完了」にできません（コーディング以降でお試しください）。" };
  }

  if (/テスト完了|テストOK/.test(text) && st === "coding") {
    const r = await setImplementationState(input.db, suggestionId, "testing");
    if (r.ok && env.ADMIN_LINE_USER_ID) {
      await notifyProgress({
        db: input.db,
        adminUserId: env.ADMIN_LINE_USER_ID,
        suggestionId,
        phase: "testing",
        detail: "テストフェーズに進めました。",
      });
    }
    return { handled: true, reply: "テスト段階に進めました。デプロイ準備ができたら「デプロイ準備OK」と送ってください。" };
  }

  if (/デプロイ準備OK|デプロイ候補/.test(text) && st === "testing") {
    const r = await setImplementationState(input.db, suggestionId, "deploy_candidate_ready");
    if (r.ok && env.ADMIN_LINE_USER_ID) {
      await notifyProgress({
        db: input.db,
        adminUserId: env.ADMIN_LINE_USER_ID,
        suggestionId,
        phase: "deploy_candidate_ready",
        detail: "デプロイ候補の状態にしました。",
      });
    }
    return {
      handled: true,
      reply:
        "デプロイ候補としてマークしました。本番反映後は「成長完了」で締めてください。自動デプロイを使う場合は管理APIで safety 確認のうえ deploying に進めてください。",
    };
  }

  log.info({ suggestionId, ap, st }, "admin growth line: no rule matched");
  return { handled: false, reply: "" };
}
