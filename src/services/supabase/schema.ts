/** Veriora canonical schema qualified names */
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
} as const;
