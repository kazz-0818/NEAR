import type { Db } from "../../db/client.js";
import { createCustomer, getCustomerById, updateCustomerDisplayFields } from "../supabase/repositories/customers.js";
import {
  findCustomerByIdentity,
  upsertCustomerIdentity,
} from "../supabase/repositories/customerIdentities.js";
import { createMergeCandidate } from "../supabase/repositories/customerMergeCandidates.js";
import type { ResolveLineProfileInput } from "./types.js";

export { findCustomerByIdentity, upsertCustomerIdentity };

export async function resolveCustomerFromLineProfile(
  db: Db,
  input: ResolveLineProfileInput
): Promise<{ customerId: string; identityId: string; created: boolean }> {
  const provider = input.provider ?? "line";
  const existing = await findCustomerByIdentity(db, provider, input.channelKey, input.externalUserId);
  if (existing) {
    if (input.externalDisplayName?.trim()) {
      await updateCustomerDisplayFields(db, existing.customerId, {
        displayName: input.externalDisplayName.trim(),
      });
    }
    const { id: identityId } = await upsertCustomerIdentity(db, {
      customerId: existing.customerId,
      provider,
      channelKey: input.channelKey,
      agentKey: input.agentKey,
      externalUserId: input.externalUserId,
      externalDisplayName: input.externalDisplayName,
      externalPictureUrl: input.externalPictureUrl,
      rawProfile: input.rawProfile,
      linkedBy: input.linkedBy ?? "auto",
    });
    return { customerId: existing.customerId, identityId, created: false };
  }

  const { id: customerId } = await createCustomer(db, {
    displayName: input.externalDisplayName?.trim() || null,
    metadata: { first_channel: input.channelKey, first_agent: input.agentKey },
  });
  const { id: identityId } = await upsertCustomerIdentity(db, {
    customerId,
    provider,
    channelKey: input.channelKey,
    agentKey: input.agentKey,
    externalUserId: input.externalUserId,
    externalDisplayName: input.externalDisplayName,
    externalPictureUrl: input.externalPictureUrl,
    rawProfile: input.rawProfile,
    linkedBy: input.linkedBy ?? "auto",
  });

  if (input.externalDisplayName?.trim()) {
    await maybeSuggestMergeByDisplayName(db, customerId, input.externalDisplayName.trim());
  }

  return { customerId, identityId, created: true };
}

async function maybeSuggestMergeByDisplayName(
  db: Db,
  customerId: string,
  displayName: string
): Promise<void> {
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
  for (const row of r.rows) {
    await createMergeCandidate(db, {
      customerIdA: customerId,
      customerIdB: row.other_id,
      reason: "display_name_match",
      score: 0.3,
    });
  }
}

export async function getCustomerProfileBundle(db: Db, customerId: string) {
  const customer = await getCustomerById(db, customerId);
  return customer;
}
