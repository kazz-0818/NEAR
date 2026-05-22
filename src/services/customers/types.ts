export const LINE_CHANNEL_KEYS = {
  near: "near_line",
  sera: "sera_line",
  lira: "lira_line",
  rits: "rits_line",
  lram: "lram_line",
} as const;

export type AgentKey = keyof typeof LINE_CHANNEL_KEYS;

export function channelKeyForAgent(agentKey: string): string {
  const k = agentKey.toLowerCase() as AgentKey;
  return LINE_CHANNEL_KEYS[k] ?? `${agentKey.toLowerCase()}_line`;
}

export type CustomerRow = {
  id: string;
  display_name: string | null;
  preferred_name: string | null;
  nickname: string | null;
  real_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  memo: string | null;
  status: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CustomerIdentityRow = {
  id: string;
  customer_id: string;
  provider: string;
  channel_key: string;
  agent_key: string | null;
  external_user_id: string;
  external_display_name: string | null;
  external_picture_url: string | null;
  raw_profile: Record<string, unknown>;
  verified: boolean;
  linked_by: string;
};

export type CustomerProfileRow = {
  id: string;
  customer_id: string;
  profile_type: string;
  profile_key: string;
  profile_value: string | null;
  confidence: number;
  source_agent_key: string | null;
  confirmed: boolean;
  is_sensitive: boolean;
  requires_confirmation: boolean;
};

export type CustomerMemoryNoteRow = {
  id: string;
  customer_id: string;
  note: string;
  category: string | null;
  source_agent_key: string | null;
  importance: string;
  confidence: number;
  confirmed: boolean;
};

export type CustomerAgentContextRow = {
  customer_id: string;
  agent_key: string;
  context_summary: string | null;
  last_interaction_at: string | null;
};

export type CustomerContextForAgent = {
  customerId: string;
  displayName: string | null;
  preferredName: string | null;
  nickname: string | null;
  confirmedProfiles: CustomerProfileRow[];
  unconfirmedProfiles: CustomerProfileRow[];
  memoryNotes: CustomerMemoryNoteRow[];
  agentContextSummary: string | null;
  crossAgentSummaries: { agentKey: string; summary: string }[];
  cautions: string[];
};

export type ResolveLineProfileInput = {
  provider?: string;
  channelKey: string;
  agentKey: string;
  externalUserId: string;
  externalDisplayName?: string | null;
  externalPictureUrl?: string | null;
  rawProfile?: Record<string, unknown>;
  linkedBy?: string;
};

export type UpsertProfileInput = {
  customerId: string;
  profileType: string;
  profileKey: string;
  profileValue: string;
  confidence?: number;
  sourceAgentKey?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  confirmed?: boolean;
  isSensitive?: boolean;
};

export type CreateMemoryNoteInput = {
  customerId: string;
  note: string;
  category?: string;
  sourceAgentKey?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  importance?: string;
  confidence?: number;
  confirmed?: boolean;
};
