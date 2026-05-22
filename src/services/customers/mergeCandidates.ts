import type { Db } from "../../db/client.js";
import {
  listMergeCandidates,
  markMergeCandidateStatus,
} from "../supabase/repositories/customerMergeCandidates.js";
import { reassignIdentitiesToCustomer } from "../supabase/repositories/customerIdentities.js";
import { softDeleteCustomer } from "../supabase/repositories/customers.js";

export { createMergeCandidate, listMergeCandidates } from "../supabase/repositories/customerMergeCandidates.js";

/**
 * 手動 merge のみ。自動 merge は行わない。
 * survivor に統合し、merged 側は status=merged（論理削除相当）。
 */
export async function mergeCustomersManual(
  db: Db,
  input: {
    survivorCustomerId: string;
    mergedCustomerId: string;
    candidateId?: string;
    linkedBy?: string;
  }
): Promise<void> {
  const survivor = input.survivorCustomerId;
  const merged = input.mergedCustomerId;
  if (survivor === merged) return;

  await reassignIdentitiesToCustomer(db, merged, survivor);

  await db.query(
    `UPDATE veriora.customer_profiles SET customer_id = $2, updated_at = now() WHERE customer_id = $1`,
    [merged, survivor]
  );
  await db.query(
    `UPDATE veriora.customer_memory_notes SET customer_id = $2, updated_at = now() WHERE customer_id = $1`,
    [merged, survivor]
  );
  await db.query(
    `UPDATE veriora.customer_agent_contexts SET customer_id = $2, updated_at = now() WHERE customer_id = $1`,
    [merged, survivor]
  );
  await db.query(
    `UPDATE veriora.customer_conversation_links SET customer_id = $2 WHERE customer_id = $1`,
    [merged, survivor]
  );
  await db.query(
    `UPDATE veriora.conversations SET customer_id = $2, updated_at = now()
     WHERE customer_id = $1`,
    [merged, survivor]
  );

  await softDeleteCustomer(db, merged);
  await db.query(
    `UPDATE veriora.customers SET status = 'merged', metadata = metadata || $2::jsonb, updated_at = now()
     WHERE id = $1`,
    [merged, JSON.stringify({ merged_into: survivor, linked_by: input.linkedBy ?? "manual" })]
  );

  if (input.candidateId) {
    await markMergeCandidateStatus(db, input.candidateId, "merged");
  }
}
