import { getEnv } from "../config/env.js";
import { getLogger } from "./logger.js";
import type { Db } from "../db/client.js";
import { getLineUserProfile, upsertLineUserProfile } from "../db/line_user_profiles_repo.js";

type RawLineProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  language?: string;
};

/** LINE Messaging API でユーザープロフィールを取得する（1:1 トーク用） */
async function fetchLineProfile(userId: string, accessToken: string): Promise<RawLineProfile | null> {
  const log = getLogger();
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      log.warn({ status: res.status, userId: userId.slice(0, 8) }, "LINE profile API failed");
      return null;
    }
    return (await res.json()) as RawLineProfile;
  } catch (e) {
    log.warn({ err: e }, "fetchLineProfile failed");
    return null;
  }
}

/** LINE グループ内メンバーのプロフィールを取得する */
async function fetchLineGroupMemberProfile(
  groupId: string,
  userId: string,
  accessToken: string
): Promise<RawLineProfile | null> {
  const log = getLogger();
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      log.warn({ status: res.status, userId: userId.slice(0, 8) }, "LINE group member profile API failed");
      return null;
    }
    return (await res.json()) as RawLineProfile;
  } catch (e) {
    log.warn({ err: e }, "fetchLineGroupMemberProfile failed");
    return null;
  }
}

/**
 * DBキャッシュだけ見て表示名を返す（LINE API は呼ばない）。
 * 高速・ノンブロッキング。キャッシュ未存在なら null。
 * プロフィール更新は fireAndForgetRefreshProfile に任せる。
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

/**
 * ユーザーの表示名を取得する。
 * DBキャッシュがあればそれを使い、なければLINE APIで取得してDBに保存する。
 * 失敗時は null を返す（呼び出し元は graceful に処理する）。
 */
export async function resolveDisplayName(
  db: Db,
  userId: string,
  groupId?: string
): Promise<string | null> {
  const log = getLogger();
  try {
    const cached = await getLineUserProfile(db, userId);
    if (cached?.displayName) return cached.displayName;

    const env = getEnv();
    const raw = groupId
      ? await fetchLineGroupMemberProfile(groupId, userId, env.LINE_CHANNEL_ACCESS_TOKEN)
      : await fetchLineProfile(userId, env.LINE_CHANNEL_ACCESS_TOKEN);

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

/**
 * メッセージ受信時にプロフィールをバックグラウンドで更新する（返信を遅らせない）。
 * 1日以上更新がない場合だけ再取得する。
 */
export function fireAndForgetRefreshProfile(
  db: Db,
  userId: string,
  groupId?: string
): void {
  const log = getLogger();
  (async () => {
    try {
      const cached = await getLineUserProfile(db, userId);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (cached && cached.lastSeenAt > oneDayAgo) {
        // 最終更新が1日以内なら last_seen_at だけ更新してAPIは呼ばない
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
      const raw = groupId
        ? await fetchLineGroupMemberProfile(groupId, userId, env.LINE_CHANNEL_ACCESS_TOKEN)
        : await fetchLineProfile(userId, env.LINE_CHANNEL_ACCESS_TOKEN);
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
