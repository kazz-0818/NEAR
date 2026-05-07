import type { Db } from "../db/client.js";
import type { Env } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import {
  buildDeployTimeDraft,
  isDeployTimeQuestion,
} from "../lib/buildInfo.js";
import { buildWhatsNewDraft, isWhatsNewCapabilityQuestion } from "../lib/whatsNew.js";
import { tryHandleAdminGrowthLine } from "../services/growth_admin_line.js";
import { tryHandleGrowthRequestingUserLine } from "../services/growth_user_line.js";
import {
  tryHandleGoogleAccountListOrSwitch,
  tryHandleGoogleOAuthUserLine,
} from "../services/google_oauth_user_line.js";
import { composeNearReplyUnified } from "../agent/compose/nearComposer.js";
import { tryHandlePermissionLine } from "../services/permission_line.js";

export type ThinRouterResult =
  | { handled: true; finalText: string }
  | { handled: false };

/**
 * LLM 意図分類より前の決定的ルート（成長・OAuth・テンプレ系）。
 */
export async function runThinRouterPhase(input: {
  db: Db;
  env: Env;
  channelUserId: string;
  actorUserId?: string;
  text: string;
  lineSourceType?: string;
}): Promise<ThinRouterResult> {
  const log = getLogger();
  const { db, env, channelUserId, actorUserId, text, lineSourceType } = input;

  // 権限管理コマンド（admin 以上のユーザーが送った場合）
  const effectiveActorId = actorUserId ?? channelUserId;
  const permResult = await tryHandlePermissionLine({ db, actorUserId: effectiveActorId, text });
  if (permResult.handled) {
    return { handled: true, finalText: permResult.reply };
  }

  if (env.ADMIN_LINE_USER_ID && channelUserId === env.ADMIN_LINE_USER_ID) {
    const growth = await tryHandleAdminGrowthLine({ db, adminUserId: channelUserId, text });
    if (growth.handled) {
      return { handled: true, finalText: growth.reply };
    }
  }

  const userGrowth = await tryHandleGrowthRequestingUserLine({ db, channelUserId, text, lineSourceType });
  if (userGrowth.handled) {
    return { handled: true, finalText: userGrowth.reply };
  }

  const googleOauth = await tryHandleGoogleOAuthUserLine({ db, channelUserId, text });
  if (googleOauth.handled && googleOauth.reply) {
    return { handled: true, finalText: googleOauth.reply };
  }

  const googleAcct = await tryHandleGoogleAccountListOrSwitch({ db, channelUserId, text });
  if (googleAcct.handled && googleAcct.reply) {
    return { handled: true, finalText: googleAcct.reply };
  }

  if (isDeployTimeQuestion(text)) {
    const draft = buildDeployTimeDraft();
    try {
      const finalText = await composeNearReplyUnified({ draft, situation: "success", userMessage: text });
      return { handled: true, finalText };
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReplyUnified failed (deploy time path)");
      return { handled: true, finalText: draft };
    }
  }

  if (isWhatsNewCapabilityQuestion(text)) {
    const draft = await buildWhatsNewDraft(db);
    try {
      const finalText = await composeNearReplyUnified({ draft, situation: "success", userMessage: text });
      return { handled: true, finalText };
    } catch (ce) {
      log.warn({ err: ce }, "composeNearReplyUnified failed (whats new path)");
      return { handled: true, finalText: draft };
    }
  }

  return { handled: false };
}
