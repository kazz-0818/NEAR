import { getEnv } from "../config/env.js";
import { getLogger } from "./logger.js";
import type { LineMemberProfileContext } from "../channels/line/groupMention.js";
import type { Db } from "../db/client.js";
import { getLineUserProfile, upsertLineUserProfile } from "../db/line_user_profiles_repo.js";

type RawLineProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  language?: string;
};

function memberProfileApiUrl(userId: string, ctx?: LineMemberProfileContext): string {
  const u = encodeURIComponent(userId);
  if (ctx?.groupId) {
    return `https://api.line.me/v2/bot/group/${encodeURIComponent(ctx.groupId)}/member/${u}`;
  }
  if (ctx?.roomId) {
    return `https://api.line.me/v2/bot/room/${encodeURIComponent(ctx.roomId)}/member/${u}`;
  }
  return `https://api.line.me/v2/bot/profile/${u}`;
}

/** 旧引数（groupId のみ）を context に変換。sourceType=room のとき room API を使う */
export function lineMemberProfileContextFromLegacy(
  groupOrRoomId: string | undefined,
  sourceType?: string
): LineMemberProfileContext | undefined {
  if (!groupOrRoomId?.trim()) return undefined;
  const id = groupOrRoomId.trim();
  if (sourceType === "room") return { roomId: id };
  if (sourceType === "group") return { groupId: id };
  return { groupId: id };
}

async function fetchLineMemberProfile(
  userId: string,
  accessToken: string,
  ctx?: LineMemberProfileContext
): Promise<RawLineProfile | null> {
  const log = getLogger();
  try {
    const res = await fetch(memberProfileApiUrl(userId, ctx), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      log.warn(
        { status: res.status, userId: userId.slice(0, 8), hasGroup: Boolean(ctx?.groupId), hasRoom: Boolean(ctx?.roomId) },
        "LINE member profile API failed"
      );
      return null;
    }
    return (await res.json()) as RawLineProfile;
  } catch (e) {
    log.warn({ err: e }, "fetchLineMemberProfile failed");
    return null;
  }
}

/**
 * DBキャッシュだけ見て表示名を返す（LINE API は呼ばない）。
 */
export async function resolveDisplayNameCacheOnly(
  db: Db,
  userId: string
): Promise<string | null> {
  try {
    const cached = await getLineUserProfile(db, userId);
    return cached?.displayName ?? null;
  } catch {
    return null;
  }
}

export async function resolveDisplayName(
  db: Db,
  userId: string,
  ctxOrLegacyGroupId?: LineMemberProfileContext | string,
  legacySourceType?: string
): Promise<string | null> {
  const log = getLogger();
  const ctx: LineMemberProfileContext | undefined =
    typeof ctxOrLegacyGroupId === "string"
      ? lineMemberProfileContextFromLegacy(ctxOrLegacyGroupId, legacySourceType)
      : ctxOrLegacyGroupId;
  try {
    const cached = await getLineUserProfile(db, userId);
    if (cached?.displayName) return cached.displayName;

    const env = getEnv();
    const raw = await fetchLineMemberProfile(userId, env.LINE_CHANNEL_ACCESS_TOKEN, ctx);

    if (!raw?.displayName) return null;

    await upsertLineUserProfile(db, {
      lineUserId: userId,
      displayName: raw.displayName,
      pictureUrl: raw.pictureUrl ?? null,
      language: raw.language ?? null,
    });

    return raw.displayName;
  } catch (e) {
    log.warn({ err: e }, "resolveDisplayName failed");
    return null;
  }
}

export function fireAndForgetRefreshProfile(
  db: Db,
  userId: string,
  ctxOrLegacyGroupId?: LineMemberProfileContext | string,
  legacySourceType?: string
): void {
  const log = getLogger();
  const ctx: LineMemberProfileContext | undefined =
    typeof ctxOrLegacyGroupId === "string"
      ? lineMemberProfileContextFromLegacy(ctxOrLegacyGroupId, legacySourceType)
      : ctxOrLegacyGroupId;
  (async () => {
    try {
      const cached = await getLineUserProfile(db, userId);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (cached && cached.lastSeenAt > oneDayAgo) {
        if (cached.displayName) {
          await upsertLineUserProfile(db, {
            lineUserId: userId,
            displayName: cached.displayName,
            pictureUrl: cached.pictureUrl,
            language: cached.language,
          });
        }
        return;
      }
      const env = getEnv();
      const raw = await fetchLineMemberProfile(userId, env.LINE_CHANNEL_ACCESS_TOKEN, ctx);
      if (raw?.displayName) {
        await upsertLineUserProfile(db, {
          lineUserId: userId,
          displayName: raw.displayName,
          pictureUrl: raw.pictureUrl ?? null,
          language: raw.language ?? null,
        });
      }
    } catch (e) {
      log.warn({ err: e }, "fireAndForgetRefreshProfile failed");
    }
  })();
}
