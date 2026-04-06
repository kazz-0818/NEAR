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
  webSearchEnabled: boolean;
};

export type NearAgentTurnResult = {
  text: string;
  log: NearAgentTurnLog;
  /** composeNearReply の situation（委譲ツールの結果を集約） */
  composeSituation: AgentComposeSituation;
};
