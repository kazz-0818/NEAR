import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";
import type { GrowthApprovalStatus, ImplementationState } from "./growth_constants.js";
import { isImplementationState } from "./growth_constants.js";

const log = getLogger();

/** implementation_state の許容遷移（専用サービス経由のみ更新すること） */
const STATE_EDGES: Record<ImplementationState, ImplementationState[]> = {
  not_started: ["awaiting_user_consent", "hearing_required", "awaiting_final_approval", "failed"],
  awaiting_user_consent: ["hearing_required", "failed"],
  hearing_required: ["awaiting_final_approval", "failed"],
  awaiting_final_approval: ["coding", "failed"],
  coding: ["testing", "implemented", "failed"],
  testing: ["deploy_candidate_ready", "implemented", "failed"],
  deploy_candidate_ready: ["deploying", "implemented", "failed"],
  deploying: ["implemented", "failed"],
  implemented: [],
  failed: [],
};

export function canTransitionImplementationState(from: ImplementationState, to: ImplementationState): boolean {
  if (from === to) return true;
  return STATE_EDGES[from]?.includes(to) ?? false;
}

export async function setImplementationState(
  db: Db,
  suggestionId: number,
  to: ImplementationState,
  opts?: { failureReason?: string | null }
): Promise<{ ok: boolean; error?: string; from?: ImplementationState }> {
  const cur = await db.query<{ implementation_state: string }>(
    `SELECT implementation_state FROM implementation_suggestions WHERE id = $1`,
    [suggestionId]
  );
  if (cur.rows.length === 0) return { ok: false, error: "suggestion not found" };
  const from = cur.rows[0].implementation_state;
  if (!isImplementationState(from)) return { ok: false, error: "invalid current state in db" };
  if (!canTransitionImplementationState(from, to)) {
    return { ok: false, error: `invalid transition: ${from} -> ${to}`, from };
  }
  await db.query(
    `UPDATE implementation_suggestions
     SET implementation_state = $1,
         failure_reason = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE failure_reason END,
         updated_at = now()
     WHERE id = $3`,
    [to, opts?.failureReason ?? null, suggestionId]
  );
  return { ok: true, from };
}

export async function setFirstApproval(
  db: Db,
  suggestionId: number,
  decision: "approved" | "rejected",
  reviewNotes?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const cur = await db.query<{ approval_status: string }>(
    `SELECT approval_status FROM implementation_suggestions WHERE id = $1`,
    [suggestionId]
  );
  if (cur.rows.length === 0) return { ok: false, error: "not found" };
  const { approval_status: ap } = cur.rows[0];
  if (ap !== "pending") return { ok: false, error: "first approval already resolved" };
  if (decision === "rejected") {
    await db.query(
      `UPDATE implementation_suggestions
       SET approval_status = 'rejected',
           implementation_state = 'failed',
           failure_reason = COALESCE($1, '成長候補が見送られました'),
           review_notes = COALESCE($2, review_notes),
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $3`,
      [reviewNotes ?? "承認: いいえ", reviewNotes, suggestionId]
    );
    await syncUnsupportedStatusForSuggestion(db, suggestionId, "rejected");
    return { ok: true };
  }
  await db.query(
    `UPDATE implementation_suggestions
     SET implementation_state = 'hearing_required',
         review_notes = COALESCE($1, review_notes),
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $2`,
    [reviewNotes, suggestionId]
  );
  await syncUnsupportedStatusForSuggestion(db, suggestionId, "user_hearing_in_progress");
  return { ok: true };
}

export async function setFinalApprovalAndStartCoding(
  db: Db,
  suggestionId: number,
  decision: "approved" | "rejected",
  reviewNotes?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const cur = await db.query<{ implementation_state: string; approval_status: string }>(
    `SELECT implementation_state, approval_status FROM implementation_suggestions WHERE id = $1`,
    [suggestionId]
  );
  if (cur.rows.length === 0) return { ok: false, error: "not found" };
  if (cur.rows[0].implementation_state !== "awaiting_final_approval") {
    return { ok: false, error: "not awaiting final approval" };
  }
  if (decision === "rejected") {
    await db.query(
      `UPDATE implementation_suggestions
       SET implementation_state = 'failed',
           failure_reason = COALESCE($1, '第二段階承認: 見送り'),
           review_notes = COALESCE($2, review_notes),
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $3`,
      [reviewNotes ?? "管理者最終承認: いいえ", reviewNotes, suggestionId]
    );
    await syncUnsupportedStatusForSuggestion(db, suggestionId, "failed");
    return { ok: true };
  }
  const r = await setImplementationState(db, suggestionId, "coding");
  if (!r.ok) return r;
  await db.query(
    `UPDATE implementation_suggestions
     SET approval_status = 'approved',
         review_notes = COALESCE($1, review_notes),
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $2`,
    [reviewNotes, suggestionId]
  );
  await syncUnsupportedStatusForSuggestion(db, suggestionId, "implementation_started");
  return { ok: true };
}

export async function markImplementationFailed(
  db: Db,
  suggestionId: number,
  reason: string
): Promise<void> {
  await db.query(
    `UPDATE implementation_suggestions
     SET implementation_state = 'failed',
         failure_reason = $1,
         updated_at = now()
     WHERE id = $2`,
    [reason, suggestionId]
  );
  await syncUnsupportedStatusForSuggestion(db, suggestionId, "failed");
}

export async function markImplementedComplete(db: Db, suggestionId: number): Promise<{ ok: boolean; error?: string }> {
  const cur = await db.query<{ implementation_state: string }>(
    `SELECT implementation_state FROM implementation_suggestions WHERE id = $1`,
    [suggestionId]
  );
  if (cur.rows.length === 0) return { ok: false, error: "not found" };
  const st = cur.rows[0].implementation_state;
  if (!isImplementationState(st)) return { ok: false, error: "bad state" };
  const allowedFrom: ImplementationState[] = ["coding", "testing", "deploy_candidate_ready", "deploying"];
  if (!allowedFrom.includes(st as ImplementationState)) {
    return { ok: false, error: `cannot complete from state ${st}` };
  }
  const r = await setImplementationState(db, suggestionId, "implemented");
  if (!r.ok) return r;
  await syncUnsupportedStatusForSuggestion(db, suggestionId, "implemented");
  return { ok: true };
}

async function syncUnsupportedStatusForSuggestion(
  db: Db,
  suggestionId: number,
  status: string
): Promise<void> {
  try {
    await db.query(
      `UPDATE unsupported_requests u
       SET status = $1, updated_at = now()
       FROM implementation_suggestions s
       WHERE s.id = $2 AND u.id = s.unsupported_request_id`,
      [status, suggestionId]
    );
  } catch (e) {
    log.warn({ err: e, suggestionId }, "sync unsupported status failed");
  }
}

/** 管理 API 用: implementation_state の任意更新（遷移ルール適用） */
export async function patchImplementationState(
  db: Db,
  suggestionId: number,
  to: ImplementationState,
  opts?: { failureReason?: string | null; deploySafetyConfirmed?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  if (to === "deploying" && opts?.deploySafetyConfirmed !== true) {
    return { ok: false, error: "deploy_safety_confirmed required to enter deploying" };
  }
  if (opts?.deploySafetyConfirmed === true) {
    await db.query(
      `UPDATE implementation_suggestions SET deploy_safety_confirmed = true, updated_at = now() WHERE id = $1`,
      [suggestionId]
    );
  }
  return setImplementationState(db, suggestionId, to, { failureReason: opts?.failureReason });
}

/** 第一段階承認だけ API で直接直す場合（LINE と併用） */
export async function patchApprovalStatus(
  db: Db,
  suggestionId: number,
  to: GrowthApprovalStatus,
  reviewNotes?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const cur = await db.query<{ approval_status: string }>(
    `SELECT approval_status FROM implementation_suggestions WHERE id = $1`,
    [suggestionId]
  );
  if (cur.rows.length === 0) return { ok: false, error: "not found" };
  const from = cur.rows[0].approval_status;
  if (from === to) {
    await db.query(
      `UPDATE implementation_suggestions SET review_notes = COALESCE($1, review_notes), updated_at = now() WHERE id = $2`,
      [reviewNotes, suggestionId]
    );
    return { ok: true };
  }
  if (from === "pending" && to === "approved") {
    const st = await db.query<{ implementation_state: string }>(
      `SELECT implementation_state FROM implementation_suggestions WHERE id = $1`,
      [suggestionId]
    );
    const impl = st.rows[0]?.implementation_state;
    if (impl === "awaiting_user_consent") {
      return {
        ok: false,
        error:
          "いまは依頼ユーザーの同意待ちです。管理APIの第一段階承認は使えません（ユーザーがLINEで返信するまでお待ちください）。",
      };
    }
    return setFirstApproval(db, suggestionId, "approved", reviewNotes);
  }
  if (from === "pending" && to === "rejected") {
    return setFirstApproval(db, suggestionId, "rejected", reviewNotes);
  }
  return { ok: false, error: `invalid approval transition ${from} -> ${to}` };
}
