import type { Db } from "../../db/client.js";
import { getEnv } from "../../config/env.js";
import { getLogger } from "../../lib/logger.js";
import { getAgentByKey } from "../supabase/repositories/agents.js";
import { linkConversationToCustomer } from "../supabase/repositories/customerConversationLinks.js";
import { channelKeyForAgent } from "./types.js";
import { resolveCustomerFromLineProfile } from "./identityRepository.js";

export type ResolveLineCustomerInput = {
  agentKey: string;
  lineUserId: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  conversationId?: string;
};

export function isCustomerMasterEnabled(): boolean {
  const env = getEnv();
  return env.VELIORA_CUSTOMER_MASTER_ENABLED !== false;
}

export async function resolveAndLinkLineCustomer(
  db: Db,
  input: ResolveLineCustomerInput
): Promise<string | null> {
  if (!isCustomerMasterEnabled()) return null;
  if (!input.lineUserId?.trim()) return null;

  try {
    const channelKey = channelKeyForAgent(input.agentKey);
    const { customerId } = await resolveCustomerFromLineProfile(db, {
      channelKey,
      agentKey: input.agentKey,
      externalUserId: input.lineUserId.trim(),
      externalDisplayName: input.displayName,
      externalPictureUrl: input.pictureUrl,
    });

    if (input.conversationId) {
      await linkConversationToCustomer(db, {
        customerId,
        conversationId: input.conversationId,
        agentKey: input.agentKey,
        linkReason: "line_webhook",
      });
    }
    return customerId;
  } catch (e) {
    getLogger().warn({ err: e, agentKey: input.agentKey }, "resolveAndLinkLineCustomer failed");
    return null;
  }
}

export async function resolveLineCustomerByAgentAndUserId(
  db: Db,
  agentKey: string,
  lineUserId: string,
  displayName?: string | null
): Promise<string | null> {
  return resolveAndLinkLineCustomer(db, {
    agentKey,
    lineUserId,
    displayName,
  });
}

export async function linkConversationForAgentKey(
  db: Db,
  input: {
    agentKey: string;
    conversationKey: string;
    lineUserId: string;
    displayName?: string | null;
  }
): Promise<{ customerId: string | null; conversationId: string | null }> {
  if (!isCustomerMasterEnabled()) return { customerId: null, conversationId: null };
  const agent = await getAgentByKey(db, input.agentKey);
  if (!agent) return { customerId: null, conversationId: null };

  const conv = await db.query<{ id: string }>(
    `SELECT id FROM veliora.conversations
     WHERE agent_id = $1 AND conversation_key = $2 LIMIT 1`,
    [agent.id, input.conversationKey]
  );
  const conversationId = conv.rows[0]?.id ?? null;
  const customerId = await resolveAndLinkLineCustomer(db, {
    agentKey: input.agentKey,
    lineUserId: input.lineUserId,
    displayName: input.displayName,
    conversationId: conversationId ?? undefined,
  });
  return { customerId, conversationId };
}
