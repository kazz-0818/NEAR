import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import { getGrowthSignalBucketById } from "../db/growth_signal_bucket_repo.js";
import { logUnsupportedFromGrowthBucket } from "../modules/unsupported_request_logger.js";
import { parsedIntentSchema } from "../models/intent.js";
import type { ParsedIntent } from "../models/intent.js";
import { evaluateGrowthSuggestionEligibility } from "./growth_suggestion_gate.js";
import { recordFunnelStep } from "./growth_funnel_service.js";
import { runGrowthPipelineAfterUnsupported } from "./growth_pipeline.js";

/**
 * バケット条件を満たしたら合成 unsupported → 既存と同じ gate / feature_suggester へ。
 * 段階導入: `NEAR_GROWTH_BUCKET_PROMOTION_ENABLED=true` が必要。
 */
export async function maybePromoteGrowthBucketAfterSignal(
  db: Db,
  input: {
    bucketId: number;
    channel: string;
    channelUserId: string;
    inboundMessageId: number;
    userText: string;
    parsed: ParsedIntent;
    primarySource: string;
  }
): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  if (!env.NEAR_GROWTH_BUCKET_PROMOTION_ENABLED) {
    log.debug({ bucketId: input.bucketId }, "growth promotion skipped: NEAR_GROWTH_BUCKET_PROMOTION_ENABLED=off");
    return;
  }

  const bucket = await getGrowthSignalBucketById(db, input.bucketId);
  if (!bucket || bucket.implementation_suggestion_id != null) {
    log.debug({ bucketId: input.bucketId, hasBucket: !!bucket }, "growth promotion skipped: no bucket or already has suggestion");
    return;
  }
  if (bucket.hit_count < env.NEAR_GROWTH_PROMOTE_MIN_BUCKET_HITS) {
    log.debug(
      { bucketId: input.bucketId, hit_count: bucket.hit_count, min: env.NEAR_GROWTH_PROMOTE_MIN_BUCKET_HITS },
      "growth promotion skipped: hit_count below min"
    );
    return;
  }
  if (bucket.priority_score < env.NEAR_GROWTH_PROMOTE_MIN_PRIORITY) {
    log.debug(
      { bucketId: input.bucketId, priority_score: bucket.priority_score, min: env.NEAR_GROWTH_PROMOTE_MIN_PRIORITY },
      "growth promotion skipped: priority below min"
    );
    return;
  }

  const allowSources = env.NEAR_GROWTH_PROMOTE_SOURCES;
  if (allowSources && allowSources.length > 0 && !allowSources.includes(input.primarySource)) {
    log.debug(
      { bucketId: input.bucketId, primarySource: input.primarySource, allowSources },
      "growth promotion skipped: source not in NEAR_GROWTH_PROMOTE_SOURCES"
    );
    return;
  }

  const textForGate = (bucket.last_user_text ?? input.userText).trim();
  if (textForGate.length < 1) return;

  let parsedForGate: ParsedIntent = input.parsed;
  if (bucket.last_parsed_intent && typeof bucket.last_parsed_intent === "object") {
    const pr = parsedIntentSchema.safeParse(bucket.last_parsed_intent);
    if (pr.success) parsedForGate = pr.data;
  }

  const gatePreview = await evaluateGrowthSuggestionEligibility({ db, text: textForGate, parsed: parsedForGate });
  if (!gatePreview.allow) {
    await recordFunnelStep(db, {
      step: "growth_promotion_evaluated",
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      allowed: false,
      reasonCode: gatePreview.reason,
      growthSignalBucketId: input.bucketId,
      detail: { phase: "gate_rejected_before_synthetic_unsupported", primary_source: input.primarySource },
    });
    return;
  }

  const inboundForPipeline = bucket.last_inbound_message_id ?? input.inboundMessageId;
  const channelUserForSynthetic = (bucket.last_channel_user_id ?? input.channelUserId).trim();

  const existing = await db.query<{ id: string }>(
    `SELECT id FROM unsupported_requests WHERE growth_signal_bucket_id = $1 LIMIT 1`,
    [input.bucketId]
  );
  const existingId = existing.rows[0]?.id != null ? Number(existing.rows[0].id) : null;

  if (existingId != null) {
    const sug = await db.query(
      `SELECT id FROM implementation_suggestions WHERE unsupported_request_id = $1 LIMIT 1`,
      [existingId]
    );
    if (sug.rows.length > 0) return;

    await runGrowthPipelineAfterUnsupported(db, log, {
      unsupportedId: existingId,
      inboundMessageId: inboundForPipeline,
      channel: input.channel,
      channelUserId: channelUserForSynthetic,
      text: textForGate,
      parsed: parsedForGate,
      growthSignalBucketId: input.bucketId,
      skipUnsupportedRecordedEvent: true,
    });
    return;
  }

  let unsupportedId: number;
  try {
    unsupportedId = await logUnsupportedFromGrowthBucket({
      db,
      channel: input.channel,
      channelUserId: channelUserForSynthetic,
      originalMessage: textForGate,
      intent: parsedForGate,
      inboundMessageId: inboundForPipeline,
      growthSignalBucketId: input.bucketId,
    });
  } catch (e) {
    log.warn({ err: e, bucketId: input.bucketId }, "logUnsupportedFromGrowthBucket failed");
    return;
  }

  await recordFunnelStep(db, {
    step: "growth_bucket_synthetic_unsupported",
    inboundMessageId: inboundForPipeline,
    unsupportedRequestId: unsupportedId,
    channel: input.channel,
    channelUserId: channelUserForSynthetic,
    reasonCode: "from_growth_signal_bucket",
    growthSignalBucketId: input.bucketId,
    detail: { bucket_id: input.bucketId },
  });

  await runGrowthPipelineAfterUnsupported(db, log, {
    unsupportedId,
    inboundMessageId: inboundForPipeline,
    channel: input.channel,
    channelUserId: channelUserForSynthetic,
    text: textForGate,
    parsed: parsedForGate,
    growthSignalBucketId: input.bucketId,
    skipUnsupportedRecordedEvent: true,
  });
}
