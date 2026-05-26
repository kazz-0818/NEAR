import type { VelioraDb } from "../client.js";
import { VELIORA_TABLES } from "../schema.js";

export async function createQualityReview(
  db: VelioraDb,
  input: {
    reviewDate: string;
    agentId?: string | null;
    scoreOverall?: number | null;
    scoreUnderstanding?: number | null;
    scoreAccuracy?: number | null;
    scoreRoleAdherence?: number | null;
    scoreActionability?: number | null;
    summary?: string | null;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VELIORA_TABLES.agentQualityReviews} (
      review_date, agent_id, score_overall, score_understanding, score_accuracy,
      score_role_adherence, score_actionability, summary
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id`,
    [
      input.reviewDate,
      input.agentId ?? null,
      input.scoreOverall ?? null,
      input.scoreUnderstanding ?? null,
      input.scoreAccuracy ?? null,
      input.scoreRoleAdherence ?? null,
      input.scoreActionability ?? null,
      input.summary ?? null,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createQualityReview: insert failed");
  return { id };
}

export async function createQualityFinding(
  db: VelioraDb,
  input: {
    reviewId?: string | null;
    agentId?: string | null;
    conversationId?: string | null;
    messageId?: string | null;
    category: string;
    severity: string;
    finding: string;
    suggestion?: string | null;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VELIORA_TABLES.agentQualityFindings} (
      review_id, agent_id, conversation_id, message_id,
      category, severity, finding, suggestion
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id`,
    [
      input.reviewId ?? null,
      input.agentId ?? null,
      input.conversationId ?? null,
      input.messageId ?? null,
      input.category,
      input.severity,
      input.finding,
      input.suggestion ?? null,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createQualityFinding: insert failed");
  return { id };
}

export async function createImprovementTask(
  db: VelioraDb,
  input: {
    sourceFindingId?: string | null;
    targetAgentId?: string | null;
    title: string;
    description?: string | null;
    cursorInstruction?: string | null;
    priority?: string;
    status?: string;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VELIORA_TABLES.agentImprovementTasks} (
      source_finding_id, target_agent_id, title, description,
      cursor_instruction, priority, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id`,
    [
      input.sourceFindingId ?? null,
      input.targetAgentId ?? null,
      input.title,
      input.description ?? null,
      input.cursorInstruction ?? null,
      input.priority ?? "medium",
      input.status ?? "draft",
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createImprovementTask: insert failed");
  return { id };
}
