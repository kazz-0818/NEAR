import type { Db } from "./client.js";

export type GrowthFunnelStep =
  | "unsupported_recorded"
  | "growth_gate"
  | "suggestion_scheduled"
  | "suggestion_created"
  | "suggestion_skipped_duplicate"
  | "suggestion_rejected_trivial"
  | "suggestion_generation_failed"
  | "user_consent_push_ok"
  | "user_consent_push_failed"
  | "admin_first_approval_push_ok"
  | "admin_first_approval_push_failed"
  | "admin_first_approval_skipped_no_destination"
  | "agent_path_completed"
  | "legacy_module_unresolved_signal"
  | "faq_deflection_signal"
  | "growth_signal_raw_suppressed"
  | "candidate_signal_recorded"
  | "growth_promotion_evaluated"
  | "growth_bucket_synthetic_unsupported";

export async function insertGrowthFunnelEvent(
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
  await db.query(
    `INSERT INTO growth_funnel_events (
       inbound_message_id, unsupported_request_id, channel, channel_user_id, step, allowed, reason_code, detail,
       growth_signal_bucket_id, implementation_suggestion_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    [
      input.inboundMessageId ?? null,
      input.unsupportedRequestId ?? null,
      input.channel ?? "line",
      input.channelUserId ?? "",
      input.step,
      input.allowed ?? null,
      input.reasonCode ?? null,
      JSON.stringify(input.detail ?? {}),
      input.growthSignalBucketId ?? null,
      input.implementationSuggestionId ?? null,
    ]
  );
}

export async function updateUnsupportedGrowthGate(
  db: Db,
  unsupportedRequestId: number,
  allow: boolean,
  reasonCode: string
): Promise<void> {
  await db.query(
    `UPDATE unsupported_requests
     SET growth_gate_allow = $1,
         growth_gate_reason = $2,
         growth_gate_evaluated_at = now(),
         updated_at = now()
     WHERE id = $3`,
    [allow, reasonCode.slice(0, 500), unsupportedRequestId]
  );
}
