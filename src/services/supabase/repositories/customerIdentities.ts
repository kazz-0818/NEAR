import type { VerioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";
import type { CustomerIdentityRow } from "../../customers/types.js";

export type UpsertIdentityInput = {
  customerId: string;
  provider: string;
  channelKey: string;
  agentKey?: string | null;
  externalUserId: string;
  externalDisplayName?: string | null;
  externalPictureUrl?: string | null;
  rawProfile?: Record<string, unknown>;
  linkedBy?: string;
  verified?: boolean;
};

export async function findCustomerByIdentity(
  db: VerioraDb,
  provider: string,
  channelKey: string,
  externalUserId: string
): Promise<{ customerId: string; identity: CustomerIdentityRow } | null> {
  const r = await db.query<CustomerIdentityRow & { customer_id: string }>(
    `SELECT id, customer_id, provider, channel_key, agent_key, external_user_id,
            external_display_name, external_picture_url, raw_profile, verified, linked_by
     FROM ${VERIORA_TABLES.customerIdentities}
     WHERE provider = $1 AND channel_key = $2 AND external_user_id = $3
     LIMIT 1`,
    [provider, channelKey, externalUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    customerId: row.customer_id,
    identity: {
      id: row.id,
      customer_id: row.customer_id,
      provider: row.provider,
      channel_key: row.channel_key,
      agent_key: row.agent_key,
      external_user_id: row.external_user_id,
      external_display_name: row.external_display_name,
      external_picture_url: row.external_picture_url,
      raw_profile: (row.raw_profile as Record<string, unknown>) ?? {},
      verified: row.verified,
      linked_by: row.linked_by,
    },
  };
}

export async function upsertCustomerIdentity(
  db: VerioraDb,
  input: UpsertIdentityInput
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.customerIdentities} (
      customer_id, provider, channel_key, agent_key, external_user_id,
      external_display_name, external_picture_url, raw_profile, linked_by, verified
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
    ON CONFLICT (provider, channel_key, external_user_id) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      agent_key = COALESCE(EXCLUDED.agent_key, ${VERIORA_TABLES.customerIdentities}.agent_key),
      external_display_name = COALESCE(EXCLUDED.external_display_name, ${VERIORA_TABLES.customerIdentities}.external_display_name),
      external_picture_url = COALESCE(EXCLUDED.external_picture_url, ${VERIORA_TABLES.customerIdentities}.external_picture_url),
      raw_profile = CASE
        WHEN EXCLUDED.raw_profile = '{}'::jsonb THEN ${VERIORA_TABLES.customerIdentities}.raw_profile
        ELSE EXCLUDED.raw_profile
      END,
      updated_at = now()
    RETURNING id`,
    [
      input.customerId,
      input.provider,
      input.channelKey,
      input.agentKey ?? null,
      input.externalUserId,
      input.externalDisplayName ?? null,
      input.externalPictureUrl ?? null,
      JSON.stringify(input.rawProfile ?? {}),
      input.linkedBy ?? "auto",
      input.verified ?? false,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("upsertCustomerIdentity: upsert failed");
  return { id };
}

export async function listIdentitiesForCustomer(
  db: VerioraDb,
  customerId: string
): Promise<CustomerIdentityRow[]> {
  const r = await db.query<CustomerIdentityRow>(
    `SELECT id, customer_id, provider, channel_key, agent_key, external_user_id,
            external_display_name, external_picture_url, raw_profile, verified, linked_by
     FROM ${VERIORA_TABLES.customerIdentities}
     WHERE customer_id = $1
     ORDER BY created_at`,
    [customerId]
  );
  return r.rows.map((row) => ({
    ...row,
    raw_profile: (row.raw_profile as Record<string, unknown>) ?? {},
  }));
}

export async function reassignIdentitiesToCustomer(
  db: VerioraDb,
  fromCustomerId: string,
  toCustomerId: string
): Promise<void> {
  await db.query(
    `UPDATE ${VERIORA_TABLES.customerIdentities}
     SET customer_id = $2, updated_at = now()
     WHERE customer_id = $1`,
    [fromCustomerId, toCustomerId]
  );
}
