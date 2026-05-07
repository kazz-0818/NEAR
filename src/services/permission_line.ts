import type { Db } from "../db/client.js";
import {
  deleteUserRole,
  getUserRole,
  listUserRoles,
  upsertUserRole,
  type UserRole,
} from "../db/user_roles_repo.js";
import { canGrantRole, hasRole, ROLE_LABEL } from "../lib/permissions.js";
import { getLineUserProfile } from "../db/line_user_profiles_repo.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger();

const ROLE_ALIASES: Record<string, UserRole> = {
  guest: "guest",
  ゲスト: "guest",
  member: "member",
  メンバー: "member",
  admin: "admin",
  管理者: "admin",
  developer: "developer",
  開発者: "developer",
  dev: "developer",
};

function parseRole(s: string): UserRole | null {
  return ROLE_ALIASES[s.toLowerCase()] ?? ROLE_ALIASES[s] ?? null;
}

/** LINE userId の短縮表示（先頭12文字） */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

async function getDisplayLabel(db: Db, lineUserId: string): Promise<string> {
  try {
    const p = await getLineUserProfile(db, lineUserId);
    if (p?.displayName) return `${p.displayName}（${shortId(lineUserId)}）`;
  } catch {
    /* fall through */
  }
  return shortId(lineUserId);
}

/** 権限付与: 「権限付与 U... member」「権限付与 U... admin メモ」 */
async function handleGrant(
  db: Db,
  actorUserId: string,
  actorRole: UserRole,
  parts: string[]
): Promise<string> {
  if (parts.length < 2) {
    return "書き方: `権限付与 {userId} {レベル}` （例: `権限付与 Uxxxxxx member`）";
  }
  const targetId = parts[0]!.trim();
  const roleStr = parts[1]!.trim();
  const notes = parts.slice(2).join(" ").trim() || null;
  const targetRole = parseRole(roleStr);

  if (!targetId.startsWith("U") || targetId.length < 10) {
    return `userId は「U」から始まる文字列です（例: Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx）。\n LINE でユーザーの userId を確認してから再度送ってください。`;
  }
  if (!targetRole) {
    return `「${roleStr}」は有効なレベルではありません。\nguest / member / admin / developer のいずれかを指定してください。`;
  }
  if (!canGrantRole(actorRole, targetRole)) {
    return `${ROLE_LABEL[actorRole]}は ${ROLE_LABEL[targetRole]} の付与権限がありません。`;
  }

  const currentRole = await getUserRole(db, targetId);
  await upsertUserRole(db, targetId, targetRole, actorUserId, notes);
  const label = await getDisplayLabel(db, targetId);

  log.info({ targetId, targetRole, actorUserId }, "user role granted");
  return `${label} の権限を **${ROLE_LABEL[currentRole]}** → **${ROLE_LABEL[targetRole]}** に変更しました。${notes ? `\nメモ: ${notes}` : ""}`;
}

/** 権限削除: 「権限削除 U...」 */
async function handleRevoke(
  db: Db,
  actorUserId: string,
  actorRole: UserRole,
  parts: string[]
): Promise<string> {
  const targetId = parts[0]?.trim() ?? "";
  if (!targetId.startsWith("U") || targetId.length < 10) {
    return "書き方: `権限削除 {userId}`";
  }
  const currentRole = await getUserRole(db, targetId);
  if (currentRole === "guest") {
    return "その userId はすでにゲスト（または未登録）です。";
  }
  if (!canGrantRole(actorRole, currentRole)) {
    return `${ROLE_LABEL[actorRole]}は ${ROLE_LABEL[currentRole]} の権限を削除できません。`;
  }
  await deleteUserRole(db, targetId);
  const label = await getDisplayLabel(db, targetId);
  log.info({ targetId, actorUserId }, "user role revoked");
  return `${label} の権限（${ROLE_LABEL[currentRole]}）を削除し、ゲストに戻しました。`;
}

/** 権限一覧: 「権限一覧」 */
async function handleList(db: Db): Promise<string> {
  const rows = await listUserRoles(db);
  if (rows.length === 0) return "現在、権限が登録されているユーザーはいません（全員ゲスト）。";
  const lines = await Promise.all(
    rows.map(async (r) => {
      const label = await getDisplayLabel(db, r.lineUserId);
      const memo = r.notes ? ` ／ ${r.notes}` : "";
      return `・**${ROLE_LABEL[r.role]}** ${label}${memo}`;
    })
  );
  return `現在の権限一覧（${rows.length}件）:\n\n${lines.join("\n")}`;
}

/** 権限確認: 「権限確認 U...」 */
async function handleCheck(db: Db, parts: string[]): Promise<string> {
  const targetId = parts[0]?.trim() ?? "";
  if (!targetId.startsWith("U") || targetId.length < 10) {
    return "書き方: `権限確認 {userId}`";
  }
  const role = await getUserRole(db, targetId);
  const label = await getDisplayLabel(db, targetId);
  return `${label} の権限: **${ROLE_LABEL[role]}**`;
}

// ---

const GRANT_RE = /^権限付与\s+(.+)$/u;
const REVOKE_RE = /^権限削除\s+(.+)$/u;
const LIST_RE = /^権限一覧$/u;
const CHECK_RE = /^権限確認\s+(.+)$/u;

function isPermissionCommand(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  return GRANT_RE.test(t) || REVOKE_RE.test(t) || LIST_RE.test(t) || CHECK_RE.test(t);
}

/**
 * 権限管理コマンドを処理する。
 * admin 以上のユーザーのみ実行可能。
 */
export async function tryHandlePermissionLine(input: {
  db: Db;
  actorUserId: string;
  text: string;
}): Promise<{ handled: boolean; reply: string }> {
  const { db, actorUserId, text } = input;
  const t = text.normalize("NFKC").trim();

  if (!isPermissionCommand(t)) return { handled: false, reply: "" };

  const actorRole = await getUserRole(db, actorUserId);

  if (!hasRole(actorRole, "admin")) {
    return {
      handled: true,
      reply: "権限管理コマンドは **管理者（admin）以上** のみ使用できます。",
    };
  }

  let reply = "";

  const grantMatch = t.match(GRANT_RE);
  if (grantMatch) {
    const parts = grantMatch[1]!.split(/\s+/);
    reply = await handleGrant(db, actorUserId, actorRole, parts);
    return { handled: true, reply };
  }

  const revokeMatch = t.match(REVOKE_RE);
  if (revokeMatch) {
    const parts = revokeMatch[1]!.split(/\s+/);
    reply = await handleRevoke(db, actorUserId, actorRole, parts);
    return { handled: true, reply };
  }

  if (LIST_RE.test(t)) {
    reply = await handleList(db);
    return { handled: true, reply };
  }

  const checkMatch = t.match(CHECK_RE);
  if (checkMatch) {
    const parts = checkMatch[1]!.split(/\s+/);
    reply = await handleCheck(db, parts);
    return { handled: true, reply };
  }

  return { handled: false, reply: "" };
}
