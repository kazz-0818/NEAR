import type { Db } from "../db/client.js";
import {
  insertGrowthFunnelEvent,
  updateUnsupportedGrowthGate,
  type GrowthFunnelStep,
} from "../db/growth_funnel_repo.js";
import type { GrowthGateResult } from "./growth_suggestion_gate.js";

/**
 * gate 判定を unsupported_requests に保存し、funnel に growth_gate を記録する。
 */
export async function recordGrowthGateEvaluated(
  db: Db,
  input: {
    unsupportedRequestId: number;
    inboundMessageId: number;
    channel: string;
    channelUserId: string;
    gate: GrowthGateResult;
    growthSignalBucketId?: number | null;
  }
): Promise<void> {
  await updateUnsupportedGrowthGate(db, input.unsupportedRequestId, input.gate.allow, input.gate.reason);
  await insertGrowthFunnelEvent(db, {
    step: "growth_gate",
    inboundMessageId: input.inboundMessageId,
    unsupportedRequestId: input.unsupportedRequestId,
    channel: input.channel,
    channelUserId: input.channelUserId,
    allowed: input.gate.allow,
    reasonCode: input.gate.reason,
    detail: { gate: input.gate, phase: "entered" },
    growthSignalBucketId: input.growthSignalBucketId ?? null,
  });
}

export async function recordFunnelStep(
  db: Db,
  input: {
    step: GrowthFunnelStep | string;
    inboundMessageId?: number | null;
    unsupportedRequestId?: number | null;
    channel?: string;
    channelUserId?: string;
    allowed?: boolean | null;
    reasonCode?: string | null;
    detail?: Record<string, unknown>;
    growthSignalBucketId?: number | null;
    implementationSuggestionId?: number | null;
  }
): Promise<void> {
  await insertGrowthFunnelEvent(db, input);
}
