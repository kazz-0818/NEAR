import type { Db } from "../../db/client.js";
import { getCustomerById } from "../supabase/repositories/customers.js";
import { createMergeCandidate } from "../supabase/repositories/customerMergeCandidates.js";
import { notifyMergeCandidateCreated } from "./mergeNotify.js";

export async function suggestMergeCandidatesForCustomer(
  db: Db,
  customerId: string
): Promise<number> {
  const customer = await getCustomerById(db, customerId);
  if (!customer) return 0;
  let n = 0;
  if (customer.display_name?.trim()) {
    n += await suggestMergeByDisplayName(db, customerId, customer.display_name.trim());
  }
  if (customer.email?.trim()) {
    n += await suggestMergeByEmail(db, customerId, customer.email.trim());
  }
  if (customer.phone?.trim()) {
    n += await suggestMergeByPhone(db, customerId, customer.phone.trim());
  }
  return n;
}

export async function suggestMergeByDisplayName(
  db: Db,
  customerId: string,
  displayName: string
): Promise<number> {
  const r = await db.query<{ other_id: string }>(
    `SELECT DISTINCT ci2.customer_id AS other_id
     FROM veriora.customer_identities ci1
     JOIN veriora.customer_identities ci2
       ON ci1.external_display_name IS NOT NULL
      AND btrim(ci1.external_display_name) = btrim(ci2.external_display_name)
      AND btrim(ci1.external_display_name) = btrim($2::text)
      AND ci1.customer_id <> ci2.customer_id
     WHERE ci1.customer_id = $1
     LIMIT 5`,
    [customerId, displayName]
  );
  let n = 0;
  for (const row of r.rows) {
    const created = await createMergeCandidateWithNotify(db, {
      customerIdA: customerId,
      customerIdB: row.other_id,
      reason: "display_name_match",
      score: 0.3,
    });
    if (created) n++;
  }
  return n;
}

export async function suggestMergeByEmail(
  db: Db,
  customerId: string,
  email: string
): Promise<number> {
  const norm = email.trim().toLowerCase();
  if (!norm.includes("@")) return 0;
  const r = await db.query<{ other_id: string }>(
    `SELECT id AS other_id FROM veriora.customers
     WHERE status = 'active' AND id <> $1
       AND email IS NOT NULL AND lower(btrim(email)) = $2
     LIMIT 5`,
    [customerId, norm]
  );
  let n = 0;
  for (const row of r.rows) {
    const created = await createMergeCandidateWithNotify(db, {
      customerIdA: customerId,
      customerIdB: row.other_id,
      reason: "email_match",
      score: 0.55,
    });
    if (created) n++;
  }
  return n;
}

export async function suggestMergeByPhone(
  db: Db,
  customerId: string,
  phone: string
): Promise<number> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return 0;
  const r = await db.query<{ other_id: string }>(
    `SELECT id AS other_id FROM veriora.customers
     WHERE status = 'active' AND id <> $1
       AND phone IS NOT NULL
       AND regexp_replace(phone, '[^0-9]', '', 'g') = $2
     LIMIT 5`,
    [customerId, digits]
  );
  let n = 0;
  for (const row of r.rows) {
    const created = await createMergeCandidateWithNotify(db, {
      customerIdA: customerId,
      customerIdB: row.other_id,
      reason: "phone_match",
      score: 0.6,
    });
    if (created) n++;
  }
  return n;
}

async function createMergeCandidateWithNotify(
  db: Db,
  input: {
    customerIdA: string;
    customerIdB: string;
    reason?: string;
    score?: number;
  }
): Promise<boolean> {
  const row = await createMergeCandidate(db, input);
  if (row?.id) {
    void notifyMergeCandidateCreated(db, {
      candidateId: row.id,
      reason: input.reason ?? "unknown",
    });
    return true;
  }
  return false;
}
