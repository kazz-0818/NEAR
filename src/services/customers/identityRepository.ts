import type { Db } from "../../db/client.js";
import { createCustomer, getCustomerById, updateCustomerDisplayFields } from "../supabase/repositories/customers.js";
import {
  findCustomerByIdentity,
  upsertCustomerIdentity,
} from "../supabase/repositories/customerIdentities.js";
import { suggestMergeByDisplayName } from "./mergeSuggestions.js";
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
    await suggestMergeByDisplayName(db, customerId, input.externalDisplayName.trim());
  }

  return { customerId, identityId, created: true };
}

export async function getCustomerProfileBundle(db: Db, customerId: string) {
  const customer = await getCustomerById(db, customerId);
  return customer;
}
