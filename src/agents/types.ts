/**
 * Veliora agent registry — 共通型定義。
 * `id` は Postgres `veliora.ai_agents.agent_code`（小文字）と揃える。
 * `code` は表示・RITS の agent_name 等との整合用（大文字推奨）。
 */
export interface AgentDefinition {
  /** Registry / DB `veliora.ai_agents.agent_key`（小文字） */
  id: string;
  /** `id` と同値。明示用エイリアス */
  agentKey: string;
  code: string;
  kana: string;
  department: string;
  displayName: string;
  role: string;
  description: string;
  primaryResponsibilities: readonly string[];
  outOfScope: readonly string[];
  handoffRules: readonly string[];
  allowedActions: readonly string[];
  requiresApprovalActions: readonly string[];
  enabled: boolean;
  /** アイコン識別子（将来の管理画面用） */
  iconKey?: string;
  /** LINE チャネル上の表示名（参考。実際は LINE Developers 側設定が正） */
  lineAccountName?: string;
  /** プロンプトファイルやキー（リポジトリ内の命名と対応） */
  systemPromptKey?: string;
  tags?: readonly string[];
  createdAt?: string;
  updatedAt?: string;
}
