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

export async function updateCustomerContactFields(
  db: VerioraDb,
  customerId: string,
  fields: { email?: string | null; phone?: string | null }
): Promise<void> {
  await db.query(
    `UPDATE ${VERIORA_TABLES.customers}
     SET email = COALESCE($2, email),
         phone = COALESCE($3, phone),
         updated_at = now()
     WHERE id = $1 AND status <> 'deleted'`,
    [customerId, fields.email ?? null, fields.phone ?? null]
  );
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

export type CustomerListRow = {
  id: string;
  display_name: string | null;
  preferred_name: string | null;
  nickname: string | null;
  status: string;
  identity_count: number;
  created_at: string;
  updated_at: string;
};

export async function listCustomers(
  db: VerioraDb,
  opts?: { status?: string; q?: string; limit?: number; offset?: number }
): Promise<CustomerListRow[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;
  const status = opts?.status ?? "active";
  const params: unknown[] = [status];
  let sql = `SELECT c.id, c.display_name, c.preferred_name, c.nickname, c.status, c.created_at, c.updated_at,
             (SELECT COUNT(*)::int FROM ${VERIORA_TABLES.customerIdentities} ci WHERE ci.customer_id = c.id) AS identity_count
             FROM ${VERIORA_TABLES.customers} c
             WHERE c.status = $1`;
  if (opts?.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    const n = params.length;
    sql += ` AND (c.display_name ILIKE $${n} OR c.preferred_name ILIKE $${n} OR c.nickname ILIKE $${n} OR c.email ILIKE $${n})`;
  }
  params.push(limit, offset);
  sql += ` ORDER BY c.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const r = await db.query<CustomerListRow>(sql, params);
  return r.rows;
}

export async function softDeleteCustomer(db: VerioraDb, customerId: string): Promise<void> {
  await db.query(
    `UPDATE ${VERIORA_TABLES.customers} SET status = 'deleted', updated_at = now() WHERE id = $1`,
    [customerId]
  );
}
