import type { Db } from "../db/client.js";
import type { ParsedIntent } from "../models/intent.js";

export type ModuleContext = {
  db: Db;
  channel: string;
  channelUserId: string;
  intent: ParsedIntent;
  originalText: string;
  inboundMessageId: number;
  /** 同一ユーザー・同一トーク内の、今回より前の発言（古い順）。未設定は従来どおり単発扱い */
  recentUserMessages?: string[];
  /** 同一トークで NEAR が今回より前に返したテキスト（古い順）。続きの整形・言い換え依頼用 */
  recentAssistantMessages?: string[];
};

export type ModuleResult = {
  success: boolean;
  draft: string;
  situation: "success" | "followup" | "unsupported" | "error";
};

export type ModuleHandler = (ctx: ModuleContext) => Promise<ModuleResult>;
