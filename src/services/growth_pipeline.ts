import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";
import { insertGrowthFunnelEvent } from "../db/growth_funnel_repo.js";
import { recordGrowthGateEvaluated, recordFunnelStep } from "./growth_funnel_service.js";
import {
  evaluateGrowthSuggestionEligibility,
  markUnsupportedGrowthSkipped,
  type GrowthGateResult,
} from "./growth_suggestion_gate.js";
import { scheduleFeatureSuggestion } from "../modules/feature_suggester.js";
import type { ParsedIntent } from "../models/intent.js";

/**
 * unsupported 記録後〜gate〜（通過時）提案スケジュールまで。
 * `growthSignalBucketId` 付きのときは合成 unsupported（バケット昇格）想定で `unsupported_recorded` を省略できる。
 */
export async function runGrowthPipelineAfterUnsupported(
  db: Db,
  log: ReturnType<typeof getLogger>,
  input: {
    unsupportedId: number;
    inboundMessageId: number;
    channel: string;
    channelUserId: string;
    text: string;
    parsed: ParsedIntent;
    growthSignalBucketId?: number | null;
    skipUnsupportedRecordedEvent?: boolean;
  }
): Promise<GrowthGateResult> {
  if (!input.skipUnsupportedRecordedEvent) {
    try {
      await insertGrowthFunnelEvent(db, {
        step: "unsupported_recorded",
        unsupportedRequestId: input.unsupportedId,
        inboundMessageId: input.inboundMessageId,
        channel: input.channel,
        channelUserId: input.channelUserId,
        reasonCode: input.parsed.intent,
        detail: {
          can_handle: input.parsed.can_handle,
          needs_followup: input.parsed.needs_followup,
        },
        growthSignalBucketId: input.growthSignalBucketId ?? null,
      });
    } catch (e) {
      log.warn({ err: e }, "growth funnel unsupported_recorded failed");
    }
  }

  const gate = await evaluateGrowthSuggestionEligibility({ db, text: input.text, parsed: input.parsed });
  try {
    await recordGrowthGateEvaluated(db, {
      unsupportedRequestId: input.unsupportedId,
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      gate,
      growthSignalBucketId: input.growthSignalBucketId ?? null,
    });
  } catch (e) {
    log.warn({ err: e }, "recordGrowthGateEvaluated failed");
  }

  if (gate.allow) {
    try {
      await recordFunnelStep(db, {
        step: "suggestion_scheduled",
        unsupportedRequestId: input.unsupportedId,
        inboundMessageId: input.inboundMessageId,
        channel: input.channel,
        channelUserId: input.channelUserId,
        reasonCode: gate.reason,
        growthSignalBucketId: input.growthSignalBucketId ?? null,
      });
    } catch (e) {
      log.warn({ err: e }, "growth funnel suggestion_scheduled failed");
    }
    scheduleFeatureSuggestion({
      db,
      unsupportedId: input.unsupportedId,
      originalMessage: input.text,
      intent: input.parsed,
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      growthSignalBucketId: input.growthSignalBucketId ?? undefined,
    });
  } else {
    await markUnsupportedGrowthSkipped(db, input.unsupportedId, gate.reason);
    log.info({ unsupportedId: input.unsupportedId, reason: gate.reason }, "growth suggestion skipped by gate");
  }

  return gate;
}
