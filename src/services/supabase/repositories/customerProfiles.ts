import type { VelioraDb } from "../client.js";
import { VELIORA_TABLES } from "../schema.js";
import type { CustomerProfileRow } from "../../customers/types.js";
import type { UpsertProfileInput } from "../../customers/types.js";

export async function upsertCustomerProfile(
  db: VelioraDb,
  input: UpsertProfileInput
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VELIORA_TABLES.customerProfiles} (
      customer_id, profile_type, profile_key, profile_value, confidence,
      source_agent_key, source_conversation_id, source_message_id,
      confirmed, is_sensitive, requires_confirmation
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (customer_id, profile_type, profile_key) DO UPDATE SET
      profile_value = EXCLUDED.profile_value,
      confidence = GREATEST(${VELIORA_TABLES.customerProfiles}.confidence, EXCLUDED.confidence),
      source_agent_key = COALESCE(EXCLUDED.source_agent_key, ${VELIORA_TABLES.customerProfiles}.source_agent_key),
      confirmed = CASE
        WHEN EXCLUDED.confirmed THEN true
        ELSE ${VELIORA_TABLES.customerProfiles}.confirmed
      END,
      is_sensitive = EXCLUDED.is_sensitive OR ${VELIORA_TABLES.customerProfiles}.is_sensitive,
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
  db: VelioraDb,
  customerId: string,
  opts?: { agentKey?: string; limit?: number }
): Promise<CustomerProfileRow[]> {
  const params: unknown[] = [customerId];
  let sql = `SELECT id, customer_id, profile_type, profile_key, profile_value, confidence,
                    source_agent_key, confirmed, is_sensitive, requires_confirmation
             FROM ${VELIORA_TABLES.customerProfiles}
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

export async function getCustomerProfileById(
  db: VelioraDb,
  profileId: string
): Promise<CustomerProfileRow | null> {
  const r = await db.query<CustomerProfileRow>(
    `SELECT id, customer_id, profile_type, profile_key, profile_value, confidence,
            source_agent_key, confirmed, is_sensitive, requires_confirmation
     FROM ${VELIORA_TABLES.customerProfiles} WHERE id = $1`,
    [profileId]
  );
  return r.rows[0] ?? null;
}

export async function patchCustomerProfile(
  db: VelioraDb,
  profileId: string,
  patch: {
    profileValue?: string;
    confirmed?: boolean;
    isSensitive?: boolean;
  }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [profileId];
  if (patch.profileValue !== undefined) {
    params.push(patch.profileValue);
    sets.push(`profile_value = $${params.length}`);
  }
  if (patch.confirmed !== undefined) {
    params.push(patch.confirmed);
    sets.push(`confirmed = $${params.length}`);
  }
  if (patch.isSensitive !== undefined) {
    params.push(patch.isSensitive);
    sets.push(`is_sensitive = $${params.length}`);
  }
  if (!sets.length) return false;
  sets.push("updated_at = now()");
  const r = await db.query(
    `UPDATE ${VELIORA_TABLES.customerProfiles} SET ${sets.join(", ")} WHERE id = $1`,
    params
  );
  return (r.rowCount ?? 0) > 0;
}
