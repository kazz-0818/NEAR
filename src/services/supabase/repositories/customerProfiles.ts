import type { VerioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";
import type { CustomerProfileRow } from "../../customers/types.js";
import type { UpsertProfileInput } from "../../customers/types.js";

export async function upsertCustomerProfile(
  db: VerioraDb,
  input: UpsertProfileInput
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.customerProfiles} (
      customer_id, profile_type, profile_key, profile_value, confidence,
      source_agent_key, source_conversation_id, source_message_id,
      confirmed, is_sensitive, requires_confirmation
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (customer_id, profile_type, profile_key) DO UPDATE SET
      profile_value = EXCLUDED.profile_value,
      confidence = GREATEST(${VERIORA_TABLES.customerProfiles}.confidence, EXCLUDED.confidence),
      source_agent_key = COALESCE(EXCLUDED.source_agent_key, ${VERIORA_TABLES.customerProfiles}.source_agent_key),
      confirmed = CASE
        WHEN EXCLUDED.confirmed THEN true
        ELSE ${VERIORA_TABLES.customerProfiles}.confirmed
      END,
      is_sensitive = EXCLUDED.is_sensitive OR ${VERIORA_TABLES.customerProfiles}.is_sensitive,
      updated_at = now()
    RETURNING id`,
    [
      input.customerId,
      input.profileType,
      input.profileKey,
      input.profileValue,
      input.confidence ?? 0.5,
      input.sourceAgentKey ?? null,
      input.sourceConversationId ?? null,
      input.sourceMessageId ?? null,
      input.confirmed ?? false,
      input.isSensitive ?? false,
      !(input.confirmed ?? false),
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("upsertCustomerProfile: upsert failed");
  return { id };
}

export async function listCustomerProfiles(
  db: VerioraDb,
  customerId: string,
  opts?: { agentKey?: string; limit?: number }
): Promise<CustomerProfileRow[]> {
  const params: unknown[] = [customerId];
  let sql = `SELECT id, customer_id, profile_type, profile_key, profile_value, confidence,
                    source_agent_key, confirmed, is_sensitive, requires_confirmation
             FROM ${VERIORA_TABLES.customerProfiles}
             WHERE customer_id = $1 AND is_sensitive = false`;
  if (opts?.agentKey) {
    params.push(opts.agentKey);
    sql += ` AND (source_agent_key IS NULL OR source_agent_key = $${params.length})`;
  }
  sql += ` ORDER BY confirmed DESC, confidence DESC, updated_at DESC`;
  if (opts?.limit) {
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }
  const r = await db.query<CustomerProfileRow>(sql, params);
  return r.rows;
}
