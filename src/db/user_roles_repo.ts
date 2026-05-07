import type { Db } from "./client.js";

export type UserRole = "guest" | "member" | "admin" | "developer";

export type UserRoleRecord = {
  lineUserId: string;
  role: UserRole;
  grantedBy: string | null;
  notes: string | null;
  grantedAt: Date;
};

export async function getUserRole(db: Db, lineUserId: string): Promise<UserRole> {
  const r = await db.query<{ role: string }>(
    `SELECT role FROM user_roles WHERE line_user_id = $1`,
    [lineUserId]
  );
  const row = r.rows[0];
  if (!row) return "guest";
  return row.role as UserRole;
}

export async function upsertUserRole(
  db: Db,
  lineUserId: string,
  role: UserRole,
  grantedBy: string | null,
  notes?: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO user_roles (line_user_id, role, granted_by, notes, granted_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (line_user_id) DO UPDATE SET
       role       = EXCLUDED.role,
       granted_by = EXCLUDED.granted_by,
       notes      = COALESCE(EXCLUDED.notes, user_roles.notes),
       updated_at = now()`,
    [lineUserId, role, grantedBy, notes ?? null]
  );
}

export async function deleteUserRole(db: Db, lineUserId: string): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM user_roles WHERE line_user_id = $1`,
    [lineUserId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listUserRoles(db: Db): Promise<UserRoleRecord[]> {
  const r = await db.query<{
    line_user_id: string;
    role: string;
    granted_by: string | null;
    notes: string | null;
    granted_at: Date;
  }>(
    `SELECT line_user_id, role, granted_by, notes, granted_at
     FROM user_roles
     WHERE role != 'guest'
     ORDER BY
       CASE role WHEN 'developer' THEN 1 WHEN 'admin' THEN 2 WHEN 'member' THEN 3 ELSE 4 END,
       granted_at ASC`
  );
  return r.rows.map((row) => ({
    lineUserId: row.line_user_id,
    role: row.role as UserRole,
    grantedBy: row.granted_by,
    notes: row.notes,
    grantedAt: row.granted_at,
  }));
}
