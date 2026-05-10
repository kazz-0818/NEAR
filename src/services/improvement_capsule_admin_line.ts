import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import {
  getCapsuleById,
  listImprovementCapsules,
  rejectCapsule,
  markCapsuleIssueCreated,
} from "./improvement_capsule_repo.js";
import { runImprovementCapsuleAnalysisJob } from "./improvement_capsule_service.js";
import { createGithubIssueForImprovementCapsule } from "./improvement_capsule_github.js";

function norm(s: string): string {
  return s.normalize("NFKC").trim();
}

/** @internal テスト用に export */
export function parseImprovementCapsuleAdminNumericId(text: string): number | null {
  const m = text.match(/(?:改善)?カプセル\s*#?(\d{1,12})\b/u);
  if (m?.[1]) return Number(m[1]);
  const m2 = text.match(/カプセル(\d{1,12})\s*(?:を|の)?(?:issue|Issue)/u);
  if (m2?.[1]) return Number(m2[1]);
  return null;
}

function isImprovementCapsuleAdminContext(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (/改善カプセル|改善候補|未分析カプセル|カプセル\s*#?\d+/u.test(t)) return true;
  if (/カプセル\s*\d+/.test(t) && /(詳細|見せて|issue|Issue|却下|不要)/iu.test(t)) return true;
  if (/これは不要|このカプセル却下|このカプセルを?\s*(?:issue|Issue)/iu.test(t)) return true;
  return false;
}

function isManualAnalyzeCommand(t: string): boolean {
  return (
    /改善カプセル分析して|改善分析して|今日の改善カプセル作って|未分析カプセルを?分析して|改善カプセル\s*分析/u.test(t) ||
    /^今日の改善カプセル/u.test(t)
  );
}

function isListCommand(t: string): boolean {
  if (/改善カプセル一覧|最近の改善カプセル/u.test(t)) return true;
  if (/未対応カプセル一覧/u.test(t)) return true;
  return false;
}

function isDetailCommand(t: string): boolean {
  return /(?:改善)?カプセル\s*#?\d+\s*(?:詳細|見せて)/u.test(t);
}

function isIssueCommand(t: string): boolean {
  if (/これは不要/.test(t)) return false;
  return (
    /(?:このカプセルを?|カプセル\s*#?\d+)\s*(?:を)?\s*(?:issue|Issue)\s*化/u.test(t) ||
    /カプセル\s*#?\d+を?\s*Issue化/u.test(t)
  );
}

function isRejectCommand(t: string): boolean {
  if (/これは不要/.test(t)) return true;
  return /(?:このカプセル|カプセル\s*#?\d+)\s*却下/u.test(t) || /カプセル\s*#?\d+\s*却下/u.test(t);
}

async function latestCapsuleId(db: Db): Promise<number | null> {
  const r = await db.query<{ capsule_id: string }>(
    `SELECT capsule_id::text FROM improvement_capsules ORDER BY capsule_id DESC LIMIT 1`
  );
  const id = r.rows[0]?.capsule_id;
  return id ? Number(id) : null;
}

export async function tryHandleImprovementCapsuleAdminLine(input: {
  db: Db;
  adminUserId: string;
  text: string;
}): Promise<{ handled: boolean; reply: string }> {
  const env = getEnv();
  const log = getLogger();
  if (!env.ADMIN_LINE_USER_ID || input.adminUserId !== env.ADMIN_LINE_USER_ID) {
    return { handled: false, reply: "" };
  }
  const raw = input.text;
  const t = norm(raw);
  if (!t) {
    return { handled: false, reply: "" };
  }

  if (isManualAnalyzeCommand(t)) {
    const r = await runImprovementCapsuleAnalysisJob(input.db, { manual: true });
    if (r.emptyManualMessage) {
      return { handled: true, reply: r.emptyManualMessage };
    }
    return {
      handled: true,
      reply: [
        "改善カプセル分析が完了しました。",
        `pending 起点: ${r.pendingStart}件 / バッチ: ${r.batchesRun} / 生成カプセル: ${r.capsulesInserted}件 / 通知対象: ${r.notifiedCapsules}件`,
      ].join("\n"),
    };
  }

  if (!isImprovementCapsuleAdminContext(t)) {
    return { handled: false, reply: "" };
  }

  if (isListCommand(t)) {
    const openStatuses = ["proposed", "notified", "approved"];
    const rows = /未対応/u.test(t)
      ? await listImprovementCapsules(input.db, { statusIn: openStatuses, limit: 15 })
      : await listImprovementCapsules(input.db, { limit: 15 });
    if (rows.length === 0) return { handled: true, reply: "改善カプセルはまだありません。" };
    const lines = rows.map((r) => `・#${r.capsule_id} [${r.status}] ${r.problem_type}: ${r.problem_summary.slice(0, 72)}`);
    return { handled: true, reply: ["【改善カプセル一覧】", ...lines].join("\n") };
  }

  if (isDetailCommand(t)) {
    const id = parseImprovementCapsuleAdminNumericId(t);
    if (id == null) return { handled: true, reply: "カプセル番号が読み取れませんでした（例: カプセル 123 詳細）。" };
    const row = await getCapsuleById(input.db, id);
    if (!row) return { handled: true, reply: `カプセル #${id} は見つかりませんでした。` };
    return {
      handled: true,
      reply: [
        `【カプセル #${id}】`,
        `状態: ${row.status}`,
        `種別: ${row.problem_type}`,
        `優先度: ${row.priority} / confidence: ${row.confidence}`,
        "",
        "概要:",
        row.context_summary,
        "",
        "検知:",
        row.problem_summary,
        "",
        "改善案:",
        row.improvement_proposal,
        row.github_issue_url ? `\nIssue: ${row.github_issue_url}` : "",
      ].join("\n"),
    };
  }

  if (isIssueCommand(t)) {
    if (!env.GITHUB_TOKEN || !env.GROWTH_GITHUB_REPO) {
      return { handled: true, reply: "GitHub Issue 作成には GITHUB_TOKEN と GROWTH_GITHUB_REPO が必要です。" };
    }
    let id = parseImprovementCapsuleAdminNumericId(t);
    if (id == null && /このカプセル/u.test(t)) {
      id = (await latestCapsuleId(input.db)) ?? null;
    }
    if (id == null) return { handled: true, reply: "どのカプセルを Issue 化するか番号で指定してください（例: カプセル 123 Issue化して）。" };
    const row = await getCapsuleById(input.db, id);
    if (!row) return { handled: true, reply: `カプセル #${id} は見つかりませんでした。` };
    if (row.github_issue_url) {
      return { handled: true, reply: `すでに Issue 化済みです。\n${row.github_issue_url}` };
    }
    try {
      const created = await createGithubIssueForImprovementCapsule(row);
      await markCapsuleIssueCreated(input.db, id, created.issueUrl);
      return {
        handled: true,
        reply: `GitHub Issue を作成しました (#${created.issueNumber})\n${created.issueUrl}`,
      };
    } catch (e) {
      log.warn({ err: e }, "improvement capsule issue create failed");
      return { handled: true, reply: "Issue 作成に失敗しました（ログを確認してください）。トークン値は出しません。" };
    }
  }

  if (isRejectCommand(t)) {
    let id = parseImprovementCapsuleAdminNumericId(t);
    if (id == null && /このカプセル|これは不要/u.test(t)) {
      id = (await latestCapsuleId(input.db)) ?? null;
    }
    if (id == null) return { handled: true, reply: "却下するカプセル番号を指定してください（例: カプセル 123 却下）。" };
    const ok = await rejectCapsule(input.db, id);
    if (!ok) return { handled: true, reply: `カプセル #${id} は却下できない状態です（既に Issue 化済み等）。` };
    return { handled: true, reply: `カプセル #${id} を却下しました。` };
  }

  return { handled: false, reply: "" };
}
