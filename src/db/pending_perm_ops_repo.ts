import type { Db } from "./client.js";
import type { UserRole } from "./user_roles_repo.js";

export type PendingPermCandidate = { lineUserId: string; displayName: string };

export type PendingPermOp = {
  actorLineUserId: string;
  opType: "grant" | "revoke";
  /** pick: 複数候補から選択中 / confirm: 確認待ち / await_role: 名前は取れたがロール待ち */
  stage: "pick" | "confirm" | "await_role";
  candidates: PendingPermCandidate[];
  targetLineUserId: string | null;
  targetDisplayName: string | null;
  /** await_role ステージのとき: 検索に使った名前文字列を notes に格納 */
  role: UserRole | null;
  notes: string | null;
  /** グループID または "1on1"。別グループに pending が引き継がれないようにスコープを絞る */
  channelId: string;
};

export async function savePendingPermOp(db: Db, op: PendingPermOp): Promise<void> {
  await db.query(
    `INSERT INTO pending_perm_ops
       (actor_line_user_id, op_type, stage, candidates_json, target_line_user_id,
        target_display_name, role, notes, channel_id, expires_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9, now() + interval '3 minutes')
     ON CONFLICT (actor_line_user_id) DO UPDATE SET
       op_type             = EXCLUDED.op_type,
       stage               = EXCLUDED.stage,
       candidates_json     = EXCLUDED.candidates_json,
       target_line_user_id = EXCLUDED.target_line_user_id,
       target_display_name = EXCLUDED.target_display_name,
       role                = EXCLUDED.role,
       notes               = EXCLUDED.notes,
       channel_id          = EXCLUDED.channel_id,
       expires_at          = EXCLUDED.expires_at`,
    [
      op.actorLineUserId,
      op.opType,
      op.stage,
      JSON.stringify(op.candidates),
      op.targetLineUserId,
      op.targetDisplayName,
      op.role,
      op.notes,
      op.channelId,
    ]
  );
}

export async function getPendingPermOp(
  db: Db,
  actorLineUserId: string,
  channelId: string
): Promise<PendingPermOp | null> {
  const r = await db.query<{
    op_type: string;
    stage: string;
    candidates_json: unknown;
    target_line_user_id: string | null;
    target_display_name: string | null;
    role: string | null;
    notes: string | null;
    channel_id: string | null;
  }>(
    // channel_id が一致するか、旧データ（NULL）の場合も消費できるようにする
    `SELECT op_type, stage, candidates_json, target_line_user_id, target_display_name, role, notes, channel_id
     FROM pending_perm_ops
     WHERE actor_line_user_id = $1
       AND (channel_id = $2 OR channel_id IS NULL)
       AND expires_at > now()`,
    [actorLineUserId, channelId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const candidates = Array.isArray(row.candidates_json)
    ? (row.candidates_json as PendingPermCandidate[])
    : [];
  return {
    actorLineUserId,
    opType: row.op_type as "grant" | "revoke",
    stage: row.stage as "pick" | "confirm" | "await_role",
    candidates,
    targetLineUserId: row.target_line_user_id,
    targetDisplayName: row.target_display_name,
    role: row.role as UserRole | null,
    notes: row.notes,
    channelId: row.channel_id ?? channelId,
  };
}

export async function deletePendingPermOp(db: Db, actorLineUserId: string): Promise<void> {
  await db.query(`DELETE FROM pending_perm_ops WHERE actor_line_user_id = $1`, [actorLineUserId]);
}
