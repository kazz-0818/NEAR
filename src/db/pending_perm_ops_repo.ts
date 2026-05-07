import type { Db } from "./client.js";
import type { UserRole } from "./user_roles_repo.js";

export type PendingPermCandidate = { lineUserId: string; displayName: string };

export type PendingPermOp = {
  actorLineUserId: string;
  opType: "grant" | "revoke";
  stage: "pick" | "confirm";
  candidates: PendingPermCandidate[];
  targetLineUserId: string | null;
  targetDisplayName: string | null;
  role: UserRole | null;
  notes: string | null;
};

export async function savePendingPermOp(db: Db, op: PendingPermOp): Promise<void> {
  await db.query(
    `INSERT INTO pending_perm_ops
       (actor_line_user_id, op_type, stage, candidates_json, target_line_user_id,
        target_display_name, role, notes, expires_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8, now() + interval '10 minutes')
     ON CONFLICT (actor_line_user_id) DO UPDATE SET
       op_type             = EXCLUDED.op_type,
       stage               = EXCLUDED.stage,
       candidates_json     = EXCLUDED.candidates_json,
       target_line_user_id = EXCLUDED.target_line_user_id,
       target_display_name = EXCLUDED.target_display_name,
       role                = EXCLUDED.role,
       notes               = EXCLUDED.notes,
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
    ]
  );
}

export async function getPendingPermOp(db: Db, actorLineUserId: string): Promise<PendingPermOp | null> {
  const r = await db.query<{
    op_type: string;
    stage: string;
    candidates_json: unknown;
    target_line_user_id: string | null;
    target_display_name: string | null;
    role: string | null;
    notes: string | null;
  }>(
    `SELECT op_type, stage, candidates_json, target_line_user_id, target_display_name, role, notes
     FROM pending_perm_ops
     WHERE actor_line_user_id = $1 AND expires_at > now()`,
    [actorLineUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const candidates = Array.isArray(row.candidates_json)
    ? (row.candidates_json as PendingPermCandidate[])
    : [];
  return {
    actorLineUserId,
    opType: row.op_type as "grant" | "revoke",
    stage: row.stage as "pick" | "confirm",
    candidates,
    targetLineUserId: row.target_line_user_id,
    targetDisplayName: row.target_display_name,
    role: row.role as UserRole | null,
    notes: row.notes,
  };
}

export async function deletePendingPermOp(db: Db, actorLineUserId: string): Promise<void> {
  await db.query(`DELETE FROM pending_perm_ops WHERE actor_line_user_id = $1`, [actorLineUserId]);
}
