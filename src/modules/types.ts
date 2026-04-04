import type { Db } from "../db/client.js";
import type { ParsedIntent } from "../models/intent.js";

export type ModuleContext = {
  db: Db;
  channel: string;
  channelUserId: string;
  intent: ParsedIntent;
  originalText: string;
  inboundMessageId: number;
};

export type ModuleResult = {
  success: boolean;
  draft: string;
  situation: "success" | "followup" | "unsupported" | "error";
};

export type ModuleHandler = (ctx: ModuleContext) => Promise<ModuleResult>;
