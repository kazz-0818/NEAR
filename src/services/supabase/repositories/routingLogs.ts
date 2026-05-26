import type { VelioraDb } from "../client.js";
import { VELIORA_TABLES } from "../schema.js";

export async function saveRoutingLog(
  db: VelioraDb,
  input: {
    conversationId?: string | null;
    fromAgentId?: string | null;
    toAgentId?: string | null;
    intent?: string | null;
    confidence?: number | null;
    reason?: string | null;
    rawResult?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VELIORA_TABLES.agentRoutingLogs} (
      conversation_id, from_agent_id, to_agent_id, intent, confidence, reason, raw_result
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    RETURNING id`,
    [
      input.conversationId ?? null,
      input.fromAgentId ?? null,
      input.toAgentId ?? null,
      input.intent ?? null,
      input.confidence ?? null,
      input.reason ?? null,
      JSON.stringify(input.rawResult ?? {}),
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("saveRoutingLog: insert failed");
  return { id };
}

export async function saveHandoffLog(
  db: VelioraDb,
  input: {
    conversationId?: string | null;
    fromAgentId?: string | null;
    toAgentId?: string | null;
    handoffReason?: string | null;
    summary?: string | null;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VELIORA_TABLES.agentHandoffLogs} (
      conversation_id, from_agent_id, to_agent_id, handoff_reason, summary
    ) VALUES ($1,$2,$3,$4,$5)
    RETURNING id`,
    [
      input.conversationId ?? null,
      input.fromAgentId ?? null,
      input.toAgentId ?? null,
      input.handoffReason ?? null,
      input.summary ?? null,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("saveHandoffLog: insert failed");
  return { id };
}
