import type { Db } from "../db/client.js";
import type { ParsedIntent } from "../models/intent.js";

export type ImprovementCandidateRow = {
  candidate_id: string;
  channel_user_id: string;
  inbound_message_id: string;
  trigger_message_id: string;
  trigger_reason: string;
  user_message: string | null;
  near_reply: string | null;
  parsed_intent: ParsedIntent | null;
  route_taken: string | null;
  module_name: string | null;
  used_llm_fallback: boolean;
  used_growth_pipeline: boolean;
  created_at: Date;
  analyzed_at: Date | null;
  analysis_batch_id: string | null;
  status: string;
};

export type ImprovementCapsuleRow = {
  capsule_id: string;
  analysis_batch_id: string;
  problem_type: string;
  problem_summary: string;
  context_summary: string;
  improvement_proposal: string;
  suggested_requirements: unknown;
  priority: string;
  confidence: number;
  source_candidate_ids: string[] | null;
  status: string;
  github_issue_url: string | null;
  created_at: Date;
  notified_at: Date | null;
  approved_at: Date | null;
  rejected_at: Date | null;
};

export async function selectInboundLineMessageId(db: Db, inboundMessageId: number): Promise<string | null> {
  const r = await db.query<{ message_id: string }>(
    `SELECT message_id FROM inbound_messages WHERE id = $1 AND channel = 'line'`,
    [inboundMessageId]
  );
  return r.rows[0]?.message_id ?? null;
}

export async function insertImprovementCandidateOrSkip(
  db: Db,
  input: {
    channelUserId: string;
    inboundMessageId: number;
    triggerMessageId: string;
    triggerReason: string;
    userMessage: string;
    nearReply: string;
    parsed: ParsedIntent | null;
    routeTaken: string;
    moduleName: string | null;
    usedLlmFallback: boolean;
    usedGrowthPipeline: boolean;
  }
): Promise<{ inserted: boolean }> {
  const dup = await db.query(
    `SELECT 1 FROM improvement_candidates
     WHERE inbound_message_id = $1 AND trigger_reason = $2 AND status = 'pending' LIMIT 1`,
    [input.inboundMessageId, input.triggerReason]
  );
  if (dup.rows.length > 0) return { inserted: false };

  await db.query(
    `INSERT INTO improvement_candidates (
       channel_user_id, inbound_message_id, trigger_message_id, trigger_reason,
       user_message, near_reply, parsed_intent, route_taken, module_name,
       used_llm_fallback, used_growth_pipeline, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,'pending')`,
    [
      input.channelUserId,
      input.inboundMessageId,
      input.triggerMessageId,
      input.triggerReason,
      input.userMessage,
      input.nearReply,
      JSON.stringify(input.parsed ?? {}),
      input.routeTaken,
      input.moduleName,
      input.usedLlmFallback,
      input.usedGrowthPipeline,
    ]
  );
  return { inserted: true };
}

export async function listPendingImprovementCandidates(db: Db, limit: number): Promise<ImprovementCandidateRow[]> {
  const r = await db.query<ImprovementCandidateRow>(
    `SELECT candidate_id::text, channel_user_id, inbound_message_id::text, trigger_message_id, trigger_reason,
            user_message, near_reply, parsed_intent, route_taken, module_name,
            used_llm_fallback, used_growth_pipeline, created_at, analyzed_at, analysis_batch_id, status
     FROM improvement_candidates
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  return r.rows.map((row) => ({
    ...row,
    parsed_intent: (row.parsed_intent as ParsedIntent | null) ?? null,
  }));
}

export async function markCandidatesStatus(
  db: Db,
  candidateIds: string[],
  status: "analyzed" | "ignored",
  batchId: string
): Promise<void> {
  if (candidateIds.length === 0) return;
  await db.query(
    `UPDATE improvement_candidates
     SET status = $2, analyzed_at = now(), analysis_batch_id = $3
     WHERE candidate_id = ANY($1::uuid[])`,
    [candidateIds, status, batchId]
  );
}

export async function insertImprovementCapsule(
  db: Db,
  input: {
    analysisBatchId: string;
    problemType: string;
    problemSummary: string;
    contextSummary: string;
    improvementProposal: string;
    suggestedRequirements: string[];
    priority: string;
    confidence: number;
    sourceCandidateIds: string[];
    status?: string;
  }
): Promise<number> {
  const r = await db.query<{ capsule_id: string }>(
    `INSERT INTO improvement_capsules (
       analysis_batch_id, problem_type, problem_summary, context_summary, improvement_proposal,
       suggested_requirements, priority, confidence, source_candidate_ids, status
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::uuid[], $10)
     RETURNING capsule_id::text`,
    [
      input.analysisBatchId,
      input.problemType,
      input.problemSummary,
      input.contextSummary,
      input.improvementProposal,
      JSON.stringify(input.suggestedRequirements),
      input.priority,
      input.confidence,
      input.sourceCandidateIds,
      input.status ?? "proposed",
    ]
  );
  return Number(r.rows[0]?.capsule_id ?? 0);
}

export async function updateCapsuleNotified(db: Db, capsuleIds: number[]): Promise<void> {
  if (capsuleIds.length === 0) return;
  await db.query(
    `UPDATE improvement_capsules
     SET status = 'notified', notified_at = now()
     WHERE capsule_id = ANY($1::bigint[]) AND status = 'proposed'`,
    [capsuleIds]
  );
}

export async function getCapsuleById(db: Db, capsuleId: number): Promise<ImprovementCapsuleRow | null> {
  const r = await db.query<ImprovementCapsuleRow>(
    `SELECT capsule_id::text, analysis_batch_id, problem_type, problem_summary, context_summary, improvement_proposal,
            suggested_requirements, priority, confidence, source_candidate_ids, status, github_issue_url,
            created_at, notified_at, approved_at, rejected_at
     FROM improvement_capsules WHERE capsule_id = $1`,
    [capsuleId]
  );
  return r.rows[0] ?? null;
}

export async function listImprovementCapsules(
  db: Db,
  input: { statusIn?: string[]; limit: number }
): Promise<ImprovementCapsuleRow[]> {
  if (input.statusIn?.length) {
    const r = await db.query<ImprovementCapsuleRow>(
      `SELECT capsule_id::text, analysis_batch_id, problem_type, problem_summary, context_summary, improvement_proposal,
              suggested_requirements, priority, confidence, source_candidate_ids, status, github_issue_url,
              created_at, notified_at, approved_at, rejected_at
       FROM improvement_capsules
       WHERE status = ANY($1::text[])
       ORDER BY created_at DESC
       LIMIT $2`,
      [input.statusIn, input.limit]
    );
    return r.rows;
  }
  const r = await db.query<ImprovementCapsuleRow>(
    `SELECT capsule_id::text, analysis_batch_id, problem_type, problem_summary, context_summary, improvement_proposal,
            suggested_requirements, priority, confidence, source_candidate_ids, status, github_issue_url,
            created_at, notified_at, approved_at, rejected_at
     FROM improvement_capsules
     ORDER BY created_at DESC
     LIMIT $1`,
    [input.limit]
  );
  return r.rows;
}

export async function rejectCapsule(db: Db, capsuleId: number): Promise<boolean> {
  const r = await db.query(
    `UPDATE improvement_capsules
     SET status = 'rejected', rejected_at = now()
     WHERE capsule_id = $1 AND status NOT IN ('issue_created', 'implemented', 'rejected')`,
    [capsuleId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function markCapsuleIssueCreated(db: Db, capsuleId: number, issueUrl: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE improvement_capsules
     SET status = 'issue_created', github_issue_url = $2, approved_at = COALESCE(approved_at, now())
     WHERE capsule_id = $1 AND status IN ('proposed', 'notified', 'approved')`,
    [capsuleId, issueUrl]
  );
  return (r.rowCount ?? 0) > 0;
}

/** 同一ユーザーが直近 window 内に送った inbound テキスト（新しい順・最大 n 件） */
export async function listRecentInboundTextsForUser(
  db: Db,
  channelUserId: string,
  beforeInboundId: number,
  windowMinutes: number,
  maxRows: number
): Promise<string[]> {
  const r = await db.query<{ text: string | null }>(
    `SELECT text FROM inbound_messages
     WHERE channel = 'line' AND channel_user_id = $1 AND id < $2
       AND created_at >= now() - make_interval(mins => $3)
     ORDER BY id DESC
     LIMIT $4`,
    [channelUserId, beforeInboundId, windowMinutes, maxRows]
  );
  return r.rows.map((x) => (x.text ?? "").trim()).filter(Boolean);
}
