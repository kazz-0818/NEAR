/** Veliora canonical Postgres schema qualified names */
export const VELIORA_SCHEMA = "veliora" as const;

export const VELIORA_TABLES = {
  aiAgents: `${VELIORA_SCHEMA}.ai_agents`,
  agentDepartments: `${VELIORA_SCHEMA}.agent_departments`,
  conversations: `${VELIORA_SCHEMA}.conversations`,
  messages: `${VELIORA_SCHEMA}.messages`,
  agentRoutingLogs: `${VELIORA_SCHEMA}.agent_routing_logs`,
  agentHandoffLogs: `${VELIORA_SCHEMA}.agent_handoff_logs`,
  agentAuditLogs: `${VELIORA_SCHEMA}.agent_audit_logs`,
  agentQualityReviews: `${VELIORA_SCHEMA}.agent_quality_reviews`,
  agentQualityFindings: `${VELIORA_SCHEMA}.agent_quality_findings`,
  agentImprovementTasks: `${VELIORA_SCHEMA}.agent_improvement_tasks`,
  lramArticleSources: `${VELIORA_SCHEMA}.lram_article_sources`,
  lramArticleCandidates: `${VELIORA_SCHEMA}.lram_article_candidates`,
  lramGeneratedArticles: `${VELIORA_SCHEMA}.lram_generated_articles`,
  lramWpPosts: `${VELIORA_SCHEMA}.lram_wp_posts`,
  messageFeed: `${VELIORA_SCHEMA}.message_feed`,
  customers: `${VELIORA_SCHEMA}.customers`,
  customerIdentities: `${VELIORA_SCHEMA}.customer_identities`,
  customerProfiles: `${VELIORA_SCHEMA}.customer_profiles`,
  customerMemoryNotes: `${VELIORA_SCHEMA}.customer_memory_notes`,
  customerMergeCandidates: `${VELIORA_SCHEMA}.customer_merge_candidates`,
  customerAgentContexts: `${VELIORA_SCHEMA}.customer_agent_contexts`,
  customerConversationLinks: `${VELIORA_SCHEMA}.customer_conversation_links`,
} as const;

/** @deprecated Use VELIORA_SCHEMA (migration 073 以前は veriora) */
export const VERIORA_SCHEMA = VELIORA_SCHEMA;

/** @deprecated Use VELIORA_TABLES */
export const VERIORA_TABLES = VELIORA_TABLES;
