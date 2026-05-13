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
import {
  ensureGithubIssueForSuggestion,
  formatLineGrowthIssueFailureReply,
  formatLineGrowthIssueSuccessReply,
} from "./growth_github_issue.js";
import { tryMergeGrowthPrFromAdminLine } from "./growth_pr_merge_service.js";

const log = getLogger();

function norm(s: string): string {
  return s.normalize("NFKC").trim();
}

function parseExplicitSuggestionId(text: string): number | null {
  const m1 = text.match(/(?:suggestion|サジェスチョン|成長案)\s*#?\s*(\d{1,12})\b/i);
  if (m1?.[1]) return Number(m1[1]);
  const m2 = text.match(/#(\d{1,12})\b/);
  if (m2?.[1]) return Number(m2[1]);
  const mentionsIssueCmd =
    /実装依頼|issue|github|cursor|カーソル|投げて|issue化|v3進めて|実装して|進めて/i.test(text);
  if (mentionsIssueCmd) {
    const m3 = text.match(/(\d{1,12})\s*$/);
    if (m3?.[1]) return Number(m3[1]);
  }
  return null;
}

/** 管理者の自然文から GitHub Issue 作成意図を検出（対象 suggestion は別途 resolve） */
function isGrowthGithubIssueCommand(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (/v3進めて/.test(t)) return true;
  if (/実装依頼/.test(t)) return true;
  if (/この成長案を実装/.test(t)) return true;
  if (/この要望を\s*issue\s*化|issue\s*化して/.test(t)) return true;
  if (/issue\s*作って|issue\s*作成して/i.test(t)) return true;
  if (/github\s*issue/i.test(t) && /(作って|作成して)/i.test(t)) return true;
  if (/githubに投げて|githubへ投げて/i.test(t)) return true;
  if (/カーソルに投げて|cursorに投げて/i.test(t)) return true;
  if (/これ進めて|これで実装/.test(t)) return true;
  if (/実装して/.test(t) && /(github|issue|cursor|カーソル|成長|要望|near)/i.test(t)) return true;
  if (/^実装して[。．!！]?$/i.test(t)) return true;
  return false;
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

  const mergeHit = await tryMergeGrowthPrFromAdminLine({
    db: input.db,
    adminUserId: input.adminUserId,
    text: raw,
  });
  if (mergeHit) {
    return { handled: true, reply: mergeHit.reply };
  }

  if (isGrowthGithubIssueCommand(text)) {
    if (!env.GROWTH_AUTO_ISSUE_ENABLED) {
      return {
        handled: true,
        reply: "GitHub Issue の自動作成は現在オフです（GROWTH_AUTO_ISSUE_ENABLED を true にしてください）。",
      };
    }
    const explicitIssueId = parseExplicitSuggestionId(text);
    const issueSuggestionId = await resolveSuggestionIdForAdmin(input.db, input.adminUserId, text, explicitIssueId);
    if (issueSuggestionId == null) {
      return {
        handled: true,
        reply:
          "どの成長案をIssue化しますか？ suggestion IDを教えてください（例: suggestion 123 実装依頼して）。",
      };
    }
    const dupRow = await input.db.query<{ github_issue_url: string | null }>(
      `SELECT github_issue_url FROM near_implementation_suggestions WHERE id = $1`,
      [issueSuggestionId]
    );
    const existingIssueUrl = dupRow.rows[0]?.github_issue_url?.trim();
    if (existingIssueUrl) {
      return {
        handled: true,
        reply: `この成長案はすでにGitHub Issue化されています。\n\nIssue:\n${existingIssueUrl}`,
      };
    }
    const issueResult = await ensureGithubIssueForSuggestion(input.db, issueSuggestionId);
    if (issueResult.ok) {
      return {
        handled: true,
        reply: formatLineGrowthIssueSuccessReply(issueResult.issueUrl, issueResult.issueNumber),
      };
    }
    return { handled: true, reply: formatLineGrowthIssueFailureReply(issueResult.message) };
  }

  const explicitId = parseExplicitSuggestionId(text);
  const suggestionId = await resolveSuggestionIdForAdmin(input.db, input.adminUserId, text, explicitId);
  if (suggestionId == null) {
    return { handled: false, reply: "" };
  }

  const row = await input.db.query<{
    approval_status: string;
    implementation_state: string;
  }>(`SELECT approval_status, implementation_state FROM near_implementation_suggestions WHERE id = $1`, [suggestionId]);

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
