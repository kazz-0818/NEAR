import type { Db } from "../db/client.js";
import { getLineUserProfile } from "../db/line_user_profiles_repo.js";
import { getUserMemory, upsertUserMemory } from "../db/user_memory_repo.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { UserMemoryPromptContext } from "../models/userMemory.js";
import { looksLikeTrivialLinePing } from "../channels/line/trivialPing.js";
import { buildUserMemoryPromptBlock } from "./user_memory_prompt.js";
import { consolidateUserMemoryWithLlm } from "./user_memory_consolidator.js";
import {
  buildCustomerContextPromptForAgent,
  isCustomerMasterEnabled,
  persistExtractedMemory,
  resolveLineCustomerByAgentAndUserId,
} from "./customers/index.js";
import { upsertCustomerProfile } from "./supabase/repositories/customerProfiles.js";

export async function loadUserMemoryPromptContext(
  db: Db,
  memorySubjectLineUserId: string,
  displayName?: string | null
): Promise<UserMemoryPromptContext | null> {
  const env = getEnv();
  if (!env.NEAR_USER_MEMORY_ENABLED) return null;

  const [row, profile] = await Promise.all([
    getUserMemory(db, memorySubjectLineUserId).catch(() => null),
    getLineUserProfile(db, memorySubjectLineUserId).catch(() => null),
  ]);

  const summary = row?.memory_summary?.trim() ?? "";
  const facts = row?.memory_facts ?? [];
  const adminMemo = profile?.memo?.trim() || null;
  const callPreference = row?.call_preference?.trim() || null;
  const name = displayName?.trim() || profile?.displayName?.trim() || null;

  if (!summary && !facts.length && !adminMemo && !callPreference) {
    return null;
  }

  return {
    memorySubjectLineUserId,
    displayName: name,
    adminMemo,
    memorySummary: summary,
    memoryFacts: facts,
    callPreference,
  };
}

export async function loadUserMemoryPromptBlock(
  db: Db,
  memorySubjectLineUserId: string,
  displayName?: string | null
): Promise<string> {
  const blocks: string[] = [];

  if (isCustomerMasterEnabled()) {
    try {
      const customerId = await resolveLineCustomerByAgentAndUserId(
        db,
        "near",
        memorySubjectLineUserId,
        displayName
      );
      if (customerId) {
        const vegapunk = await buildCustomerContextPromptForAgent(db, customerId, "near");
        if (vegapunk.trim()) blocks.push(vegapunk.trim());
      }
    } catch (e) {
      getLogger().warn({ err: e }, "buildCustomerContextPromptForAgent failed; fallback to near_user_memory");
    }
  }

  const ctx = await loadUserMemoryPromptContext(db, memorySubjectLineUserId, displayName);
  const legacy = buildUserMemoryPromptBlock(ctx);
  if (legacy.trim()) blocks.push(legacy.trim());

  return blocks.join("\n\n");
}

export function shouldConsolidateUserMemory(input: {
  userText: string;
  nearReply: string;
  inboundMessageId: number;
  lastConsolidatedInboundId: number | null;
}): boolean {
  const env = getEnv();
  if (!env.NEAR_USER_MEMORY_ENABLED) return false;
  if (!env.NEAR_USER_MEMORY_CONSOLIDATE_ENABLED) return false;
  if (input.inboundMessageId <= 0) return false;
  if (looksLikeTrivialLinePing(input.userText)) return false;

  const userLen = input.userText.replace(/\s+/g, "").length;
  const replyLen = input.nearReply.replace(/\s+/g, "").length;
  if (userLen < env.NEAR_USER_MEMORY_MIN_USER_CHARS && replyLen < 40) return false;

  if (input.lastConsolidatedInboundId != null) {
    const delta = input.inboundMessageId - input.lastConsolidatedInboundId;
    if (delta > 0 && delta < env.NEAR_USER_MEMORY_CONSOLIDATE_EVERY_N_TURNS) {
      return false;
    }
  }
  return true;
}

export async function maybeConsolidateUserMemoryAfterReply(input: {
  db: Db;
  memorySubjectLineUserId: string;
  displayName?: string | null;
  inboundMessageId: number;
  userText: string;
  nearReply: string;
  recentUserMessages: string[];
  recentAssistantMessages: string[];
}): Promise<void> {
  const env = getEnv();
  if (!env.NEAR_USER_MEMORY_ENABLED) return;

  const existing = await getUserMemory(input.db, input.memorySubjectLineUserId).catch(() => null);
  if (
    !shouldConsolidateUserMemory({
      userText: input.userText,
      nearReply: input.nearReply,
      inboundMessageId: input.inboundMessageId,
      lastConsolidatedInboundId: existing?.last_consolidated_inbound_id ?? null,
    })
  ) {
    return;
  }

  const profile = await getLineUserProfile(input.db, input.memorySubjectLineUserId).catch(() => null);

  const merged = await consolidateUserMemoryWithLlm({
    displayName: input.displayName ?? profile?.displayName ?? null,
    adminMemo: profile?.memo ?? null,
    existing,
    userText: input.userText,
    nearReply: input.nearReply,
    recentUserMessages: input.recentUserMessages,
    recentAssistantMessages: input.recentAssistantMessages,
  });

  if (!merged) return;

  const hasContent =
    merged.memorySummary.length > 0 || merged.memoryFacts.length > 0 || !!merged.callPreference;
  if (!hasContent && !existing) return;

  await upsertUserMemory(input.db, {
    lineUserId: input.memorySubjectLineUserId,
    memorySummary: merged.memorySummary,
    memoryFacts: merged.memoryFacts,
    callPreference: merged.callPreference,
    lastConsolidatedInboundId: input.inboundMessageId,
  });

  getLogger().info(
    {
      memorySubject: input.memorySubjectLineUserId.slice(0, 8),
      inboundMessageId: input.inboundMessageId,
      factCount: merged.memoryFacts.length,
    },
    "user memory consolidated"
  );

  if (isCustomerMasterEnabled()) {
    try {
      const customerId = await resolveLineCustomerByAgentAndUserId(
        input.db,
        "near",
        input.memorySubjectLineUserId,
        input.displayName
      );
      if (customerId) {
        if (merged.callPreference?.trim()) {
          await upsertCustomerProfile(input.db, {
            customerId,
            profileType: "nickname",
            profileKey: "preferred_name",
            profileValue: merged.callPreference.trim(),
            confidence: 0.85,
            sourceAgentKey: "near",
            confirmed: true,
          });
        }
        if (merged.memorySummary.trim()) {
          await upsertCustomerProfile(input.db, {
            customerId,
            profileType: "memo",
            profileKey: "memory_summary",
            profileValue: merged.memorySummary.trim().slice(0, 2000),
            confidence: 0.7,
            sourceAgentKey: "near",
            confirmed: false,
          });
        }
        void persistExtractedMemory(input.db, {
          customerId,
          agentKey: "near",
          userText: input.userText,
          assistantText: input.nearReply,
        }).catch(() => undefined);
      }
    } catch (e) {
      getLogger().warn({ err: e }, "customer master dual-write after consolidate failed");
    }
  }
}
