import type { VelioraDb } from "../client.js";
import { VELIORA_TABLES } from "../schema.js";
import type { CustomerAgentContextRow } from "../../customers/types.js";

export async function getCustomerAgentContext(
  db: VelioraDb,
  customerId: string,
  agentKey: string
): Promise<CustomerAgentContextRow | null> {
  const r = await db.query<CustomerAgentContextRow>(
    `SELECT customer_id, agent_key, context_summary, last_interaction_at
     FROM ${VELIORA_TABLES.customerAgentContexts}
     WHERE customer_id = $1 AND agent_key = $2`,
    [customerId, agentKey]
  );
  return r.rows[0] ?? null;
}

export async function upsertCustomerAgentContext(
  db: VelioraDb,
  input: {
    customerId: string;
    agentKey: string;
    contextSummary?: string | null;
    lastConversationId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO ${VELIORA_TABLES.customerAgentContexts} (
      customer_id, agent_key, context_summary, last_conversation_id, last_interaction_at, metadata
    ) VALUES ($1,$2,$3,$4, now(), $5::jsonb)
    ON CONFLICT (customer_id, agent_key) DO UPDATE SET
      context_summary = COALESCE(EXCLUDED.context_summary, ${VELIORA_TABLES.customerAgentContexts}.context_summary),
      last_conversation_id = COALESCE(EXCLUDED.last_conversation_id, ${VELIORA_TABLES.customerAgentContexts}.last_conversation_id),
      last_interaction_at = now(),
      metadata = ${VELIORA_TABLES.customerAgentContexts}.metadata || EXCLUDED.metadata,
      updated_at = now()`,
    [
      input.customerId,
      input.agentKey,
      input.contextSummary ?? null,
      input.lastConversationId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

export async function listAgentContextsForCustomer(
  db: VelioraDb,
  customerId: string,
  excludeAgentKey?: string
): Promise<CustomerAgentContextRow[]> {
  const params: unknown[] = [customerId];
  let sql = `SELECT customer_id, agent_key, context_summary, last_interaction_at
             FROM ${VELIORA_TABLES.customerAgentContexts}
             WHERE customer_id = $1 AND context_summary IS NOT NULL AND btrim(context_summary) <> ''`;
  if (excludeAgentKey) {
    params.push(excludeAgentKey);
    sql += ` AND agent_key <> $${params.length}`;
  }
  const r = await db.query<CustomerAgentContextRow>(sql, params);
  return r.rows;
}
