import type { VerioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";
import type { CustomerRow } from "../../customers/types.js";

export type CreateCustomerInput = {
  displayName?: string | null;
  preferredName?: string | null;
  nickname?: string | null;
  memo?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createCustomer(
  db: VerioraDb,
  input: CreateCustomerInput = {}
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.customers} (
      display_name, preferred_name, nickname, memo, metadata
    ) VALUES ($1,$2,$3,$4,$5::jsonb)
    RETURNING id`,
    [
      input.displayName ?? null,
      input.preferredName ?? null,
      input.nickname ?? null,
      input.memo ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createCustomer: insert failed");
  return { id };
}

export async function getCustomerById(db: VerioraDb, customerId: string): Promise<CustomerRow | null> {
  const r = await db.query<CustomerRow>(
    `SELECT id, display_name, preferred_name, nickname, real_name, email, phone,
            company_name, memo, status, tags, metadata, created_at, updated_at
     FROM ${VERIORA_TABLES.customers}
     WHERE id = $1 AND status <> 'deleted'`,
    [customerId]
  );
  return r.rows[0] ?? null;
}

export async function updateCustomerDisplayFields(
  db: VerioraDb,
  customerId: string,
  fields: {
    displayName?: string | null;
    preferredName?: string | null;
    nickname?: string | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE ${VERIORA_TABLES.customers}
     SET display_name = COALESCE($2, display_name),
         preferred_name = COALESCE($3, preferred_name),
         nickname = COALESCE($4, nickname),
         updated_at = now()
     WHERE id = $1`,
    [customerId, fields.displayName ?? null, fields.preferredName ?? null, fields.nickname ?? null]
  );
}

export async function softDeleteCustomer(db: VerioraDb, customerId: string): Promise<void> {
  await db.query(
    `UPDATE ${VERIORA_TABLES.customers} SET status = 'deleted', updated_at = now() WHERE id = $1`,
    [customerId]
  );
}
