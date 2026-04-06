import type { Db } from "../db/client.js";
import type { AgentComposeSituation } from "./composeSituation.js";

/** カスタムツール実行時に渡すコンテキスト（サーバー側・ユーザー単位） */
export type NearAgentToolContext = {
  db: Db;
  channel: string;
  channelUserId: string;
  inboundMessageId: number;
  userText: string;
  recentUserMessages: string[];
  recentAssistantMessages: string[];
};

export type NearAgentTurnInput = NearAgentToolContext;

export type NearAgentTurnLog = {
  steps: number;
  toolsInvoked: string[];
  model: string;
  /** 環境で Web 検索が無効化されていないか（NEAR_AGENT_WEB_SEARCH） */
  webSearchEnabled: boolean;
  /** 本ターンのリクエストで web_search_preview を付与したか */
  webSearchAttached?: boolean;
  /** 付与判定理由（ポリシー or legacy） */
  webSearchReasonCode?: string;
  /** NEAR_WEB_SEARCH_POLICY_ENABLED */
  webSearchPolicyEnabled?: boolean;
};

export type NearAgentTurnResult = {
  text: string;
  log: NearAgentTurnLog;
  /** composeNearReply の situation（委譲ツールの結果を集約） */
  composeSituation: AgentComposeSituation;
};
