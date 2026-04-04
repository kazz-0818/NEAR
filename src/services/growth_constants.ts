/** implementation_suggestions.approval_status（第一段階: 成長候補として進めるか） */
export const GROWTH_APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type GrowthApprovalStatus = (typeof GROWTH_APPROVAL_STATUSES)[number];

/** implementation_suggestions.implementation_state */
export const IMPLEMENTATION_STATES = [
  "not_started",
  "hearing_required",
  "awaiting_final_approval",
  "coding",
  "testing",
  "deploy_candidate_ready",
  "deploying",
  "implemented",
  "failed",
] as const;
export type ImplementationState = (typeof IMPLEMENTATION_STATES)[number];

/** unsupported_requests.status（成長フロー用） */
export const UNSUPPORTED_FLOW_STATUSES = [
  "logged",
  "suggestion_created",
  "admin_approval_requested",
  "hearing_in_progress",
  "final_approval_requested",
  "implementation_started",
  "implemented",
  "rejected",
  "failed",
] as const;
export type UnsupportedFlowStatus = (typeof UNSUPPORTED_FLOW_STATUSES)[number];

export function isImplementationState(s: string): s is ImplementationState {
  return (IMPLEMENTATION_STATES as readonly string[]).includes(s);
}

export function isGrowthApprovalStatus(s: string): s is GrowthApprovalStatus {
  return (GROWTH_APPROVAL_STATUSES as readonly string[]).includes(s);
}
