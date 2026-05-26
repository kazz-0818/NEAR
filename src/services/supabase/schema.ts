/** Veliora canonical schema qualified names */
export const VERIORA_SCHEMA = "veriora" as const;

export const VERIORA_TABLES = {
  aiAgents: `${VERIORA_SCHEMA}.ai_agents`,
  agentDepartments: `${VERIORA_SCHEMA}.agent_departments`,
  conversations: `${VERIORA_SCHEMA}.conversations`,
  messages: `${VERIORA_SCHEMA}.messages`,
  agentRoutingLogs: `${VERIORA_SCHEMA}.agent_routing_logs`,
  agentHandoffLogs: `${VERIORA_SCHEMA}.agent_handoff_logs`,
  agentAuditLogs: `${VERIORA_SCHEMA}.agent_audit_logs`,
  agentQualityReviews: `${VERIORA_SCHEMA}.agent_quality_reviews`,
  agentQualityFindings: `${VERIORA_SCHEMA}.agent_quality_findings`,
  agentImprovementTasks: `${VERIORA_SCHEMA}.agent_improvement_tasks`,
  lramArticleSources: `${VERIORA_SCHEMA}.lram_article_sources`,
  lramArticleCandidates: `${VERIORA_SCHEMA}.lram_article_candidates`,
  lramGeneratedArticles: `${VERIORA_SCHEMA}.lram_generated_articles`,
  lramWpPosts: `${VERIORA_SCHEMA}.lram_wp_posts`,
  messageFeed: `${VERIORA_SCHEMA}.message_feed`,
  customers: `${VERIORA_SCHEMA}.customers`,
  customerIdentities: `${VERIORA_SCHEMA}.customer_identities`,
  customerProfiles: `${VERIORA_SCHEMA}.customer_profiles`,
  customerMemoryNotes: `${VERIORA_SCHEMA}.customer_memory_notes`,
  customerMergeCandidates: `${VERIORA_SCHEMA}.customer_merge_candidates`,
  customerAgentContexts: `${VERIORA_SCHEMA}.customer_agent_contexts`,
  customerConversationLinks: `${VERIORA_SCHEMA}.customer_conversation_links`,
} as const;
