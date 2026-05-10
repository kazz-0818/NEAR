import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import type { ParsedIntent } from "../models/intent.js";
import {
  collectLocalRuleHits,
  roughSimilarUserUtterances,
  type ImprovementRoutingSnapshot,
} from "./improvement_capsule_rules.js";
import { insertImprovementCandidateOrSkip, listRecentInboundTextsForUser, selectInboundLineMessageId } from "./improvement_capsule_repo.js";

export type RecordImprovementCandidateInput = {
  db: Db;
  channelUserId: string;
  inboundMessageId: number;
  userText: string;
  nearReply: string;
  snap: ImprovementRoutingSnapshot;
};

async function shouldRecordRapidSimilarRephrases(
  db: Db,
  channelUserId: string,
  inboundMessageId: number,
  currentText: string,
  windowMinutes: number
): Promise<boolean> {
  const prev = await listRecentInboundTextsForUser(db, channelUserId, inboundMessageId, windowMinutes, 16);
  let similarPrev = 0;
  for (const p of prev) {
    if (roughSimilarUserUtterances(p, currentText)) similarPrev++;
  }
  return similarPrev >= 2;
}

/**
 * NEAR 返信直後に軽量ルールのみで候補を保存（LLM は呼ばない）。
 */
export async function recordImprovementCandidatesIfEligible(input: RecordImprovementCandidateInput): Promise<void> {
  const env = getEnv();
  if (!env.NEAR_IMPROVEMENT_CAPSULES_ENABLED) return;

  const log = getLogger();
  const { db, channelUserId, inboundMessageId, userText, nearReply, snap } = input;

  const triggerMessageId = (await selectInboundLineMessageId(db, inboundMessageId)) ?? String(inboundMessageId);

  const hits = collectLocalRuleHits(userText, snap);

  let rapid = false;
  try {
    rapid = await shouldRecordRapidSimilarRephrases(
      db,
      channelUserId,
      inboundMessageId,
      userText,
      env.NEAR_IMPROVEMENT_CAPSULE_RAPID_WINDOW_MINUTES
    );
  } catch (e) {
    log.warn({ err: e }, "improvement capsule rapid-rephrase check failed");
  }
  if (rapid) {
    hits.push({ triggerReason: "rapid_similar_rephrase", label: "短時間に似た依頼の言い直し" });
  }

  if (hits.length === 0) return;

  for (const h of hits) {
    const r = await insertImprovementCandidateOrSkip(db, {
      channelUserId,
      inboundMessageId,
      triggerMessageId,
      triggerReason: h.triggerReason,
      userMessage: userText,
      nearReply,
      parsed: snap.parsed,
      routeTaken: snap.routeTaken,
      moduleName: snap.moduleName,
      usedLlmFallback: snap.usedLlmFallback,
      usedGrowthPipeline: snap.usedGrowthPipeline,
    });
    if (r.inserted) {
      log.info({ inboundMessageId, triggerReason: h.triggerReason }, "improvement candidate recorded");
    }
  }
}

export function buildRoutingSnapshot(partial: Partial<ImprovementRoutingSnapshot> & { userText: string }): ImprovementRoutingSnapshot {
  return {
    userText: partial.userText,
    parsed: partial.parsed ?? null,
    routeTaken: partial.routeTaken ?? "unknown",
    moduleName: partial.moduleName ?? null,
    usedLlmFallback: partial.usedLlmFallback ?? false,
    usedGrowthPipeline: partial.usedGrowthPipeline ?? false,
    preGrowthCategory: partial.preGrowthCategory ?? null,
  };
}
