import type { VelioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export async function saveAuditLog(
  db: VelioraDb,
  input: {
    agentId?: string | null;
    eventType: string;
    severity?: string;
    message?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.agentAuditLogs} (agent_id, event_type, severity, message, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     RETURNING id`,
    [
      input.agentId ?? null,
      input.eventType,
      input.severity ?? "info",
      input.message ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("saveAuditLog: insert failed");
  return { id };
}
