import type { Db } from "../db/client.js";
import { getLogger } from "../lib/logger.js";

/**
 * グループ/ルームでメッセージを受けたときに 1 行 UPSERT（テーブルエディタで ID を確認できるようにする）
 */
export async function recordObservedLineGroupOrRoom(
  db: Db,
  lineGroupOrRoomId: string,
  sourceKind: "group" | "room"
): Promise<void> {
  const id = lineGroupOrRoomId.trim();
  if (!id) return;

  await db.query(
    `INSERT INTO near_line_groups (
       line_group_or_room_id, label, purpose, notify_push, enabled, source_kind, last_seen_at, created_at, updated_at
     ) VALUES ($1, NULL, 'discovered', false, true, $2, now(), now(), now())
     ON CONFLICT (line_group_or_room_id) DO UPDATE SET
       last_seen_at = now(),
       updated_at = now(),
       source_kind = COALESCE(near_line_groups.source_kind, EXCLUDED.source_kind)`,
    [id, sourceKind]
  );
}

export function fireAndForgetObserveLineGroup(
  db: Db,
  lineGroupOrRoomId: string | undefined,
  sourceKind: "group" | "room"
): void {
  if (!lineGroupOrRoomId?.trim()) return;
  void recordObservedLineGroupOrRoom(db, lineGroupOrRoomId, sourceKind).catch((err) => {
    getLogger().warn({ err, lineGroupOrRoomId }, "near_line_groups auto observe failed");
  });
}
