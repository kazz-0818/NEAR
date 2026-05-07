import type { Db } from "../db/client.js";
import {
  deleteUserRole,
  getUserRole,
  listUserRoles,
  upsertUserRole,
  type UserRole,
} from "../db/user_roles_repo.js";
import { canGrantRole, hasRole, ROLE_LABEL } from "../lib/permissions.js";
import { getLineUserProfile, searchLineUserProfilesByName } from "../db/line_user_profiles_repo.js";
import {
  deletePendingPermOp,
  getPendingPermOp,
  savePendingPermOp,
  type PendingPermCandidate,
} from "../db/pending_perm_ops_repo.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger();

// ─── ロール別名 ──────────────────────────────────────────────────────────────

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

// ─── ユーティリティ ───────────────────────────────────────────────────────────

/** LINE userId か（U + 28文字以上の英数字）*/
function looksLikeUserId(s: string): boolean {
  return /^U[a-fA-F0-9]{10,}$/.test(s.trim());
}

/** LINE userId の短縮表示 */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

async function getDisplayLabel(db: Db, lineUserId: string): Promise<string> {
  try {
    const p = await getLineUserProfile(db, lineUserId);
    if (p?.displayName) return `${p.displayName}（${shortId(lineUserId)}）`;
  } catch { /* fall through */ }
  return shortId(lineUserId);
}

function buildPickMessage(candidates: PendingPermCandidate[], op: "grant" | "revoke", role?: UserRole | null): string {
  const lines = candidates.map((c, i) => `${i + 1}. ${c.displayName}`);
  const opLabel = op === "grant" ? `${ROLE_LABEL[role ?? "member"]} 権限を付与` : "権限を削除";
  return (
    `「${candidates[0]!.displayName.slice(0, 10)}」という名前のユーザーが複数見つかりました。\n${opLabel}する方の番号を教えてください。\n\n${lines.join("\n")}\n\nキャンセルする場合は「キャンセル」と送ってください。`
  );
}

function buildConfirmMessage(displayName: string, op: "grant" | "revoke", role?: UserRole | null): string {
  const opLabel = op === "grant" ? `**${ROLE_LABEL[role ?? "member"]}** 権限を付与` : "権限を削除";
  return `**${displayName}** 様でよろしいですか？\n操作: ${opLabel}\n\n「はい」か「キャンセル」で答えてください。`;
}

// ─── 名前検索 → 保留フロー起動 ────────────────────────────────────────────────

async function startNameSearchFlow(
  db: Db,
  actorUserId: string,
  actorRole: UserRole,
  opType: "grant" | "revoke",
  nameQuery: string,
  role: UserRole | null,
  notes: string | null
): Promise<string> {
  if (!canGrantRole(actorRole, role ?? "member")) {
    return `${ROLE_LABEL[actorRole]}は ${ROLE_LABEL[role ?? "member"]} の付与権限がありません。`;
  }

  const matches = await searchLineUserProfilesByName(db, nameQuery);

  if (matches.length === 0) {
    return (
      `「${nameQuery}」という表示名のユーザーが見つかりませんでした。\n\n` +
      `まだ NEAR に話しかけたことがない方はキャッシュが無いため見つかりません。\n` +
      `直接 userId（LINE の userId）で指定するか、その方に一度 NEAR へメッセージを送ってもらってから再試行してください。`
    );
  }

  const candidates: PendingPermCandidate[] = matches.map((m) => ({
    lineUserId: m.lineUserId,
    displayName: m.displayName,
  }));

  if (candidates.length === 1) {
    // 確認ステージへ
    const c = candidates[0]!;
    await savePendingPermOp(db, {
      actorLineUserId: actorUserId,
      opType,
      stage: "confirm",
      candidates,
      targetLineUserId: c.lineUserId,
      targetDisplayName: c.displayName,
      role,
      notes,
    });
    return buildConfirmMessage(c.displayName, opType, role);
  }

  // 複数候補 → pick ステージ
  await savePendingPermOp(db, {
    actorLineUserId: actorUserId,
    opType,
    stage: "pick",
    candidates,
    targetLineUserId: null,
    targetDisplayName: null,
    role,
    notes,
  });
  return buildPickMessage(candidates, opType, role);
}

// ─── コマンドパーサ ───────────────────────────────────────────────────────────

async function handleGrant(db: Db, actorUserId: string, actorRole: UserRole, parts: string[]): Promise<string> {
  if (parts.length < 2) {
    return "書き方: `権限付与 {名前または userId} {レベル}`（例: `権限付与 田中 member`）";
  }
  const target = parts[0]!.trim();
  const roleStr = parts[1]!.trim();
  const notes = parts.slice(2).join(" ").trim() || null;
  const targetRole = parseRole(roleStr);

  if (!targetRole) {
    return `「${roleStr}」は有効なレベルではありません。\nguest / member / admin / developer のいずれかを指定してください。`;
  }

  // userId 直接指定
  if (looksLikeUserId(target)) {
    if (!canGrantRole(actorRole, targetRole)) {
      return `${ROLE_LABEL[actorRole]}は ${ROLE_LABEL[targetRole]} の付与権限がありません。`;
    }
    const currentRole = await getUserRole(db, target);
    await upsertUserRole(db, target, targetRole, actorUserId, notes);
    const label = await getDisplayLabel(db, target);
    log.info({ target, targetRole, actorUserId }, "user role granted (direct)");
    return `${label} の権限を **${ROLE_LABEL[currentRole]}** → **${ROLE_LABEL[targetRole]}** に変更しました。${notes ? `\nメモ: ${notes}` : ""}`;
  }

  // 名前検索フロー
  return startNameSearchFlow(db, actorUserId, actorRole, "grant", target, targetRole, notes);
}

async function handleRevoke(db: Db, actorUserId: string, actorRole: UserRole, parts: string[]): Promise<string> {
  const target = parts[0]?.trim() ?? "";
  if (!target) return "書き方: `権限削除 {名前または userId}`";

  // userId 直接指定
  if (looksLikeUserId(target)) {
    const currentRole = await getUserRole(db, target);
    if (currentRole === "guest") return "その userId はすでにゲスト（または未登録）です。";
    if (!canGrantRole(actorRole, currentRole)) {
      return `${ROLE_LABEL[actorRole]}は ${ROLE_LABEL[currentRole]} の権限を削除できません。`;
    }
    await deleteUserRole(db, target);
    const label = await getDisplayLabel(db, target);
    log.info({ target, actorUserId }, "user role revoked (direct)");
    return `${label} の権限（${ROLE_LABEL[currentRole]}）を削除し、ゲストに戻しました。`;
  }

  // 名前検索フロー
  return startNameSearchFlow(db, actorUserId, actorRole, "revoke", target, null, null);
}

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

async function handleCheck(db: Db, parts: string[]): Promise<string> {
  const target = parts[0]?.trim() ?? "";
  if (!target) return "書き方: `権限確認 {名前または userId}`";

  if (looksLikeUserId(target)) {
    const role = await getUserRole(db, target);
    const label = await getDisplayLabel(db, target);
    return `${label} の権限: **${ROLE_LABEL[role]}**`;
  }

  // 名前検索
  const matches = await searchLineUserProfilesByName(db, target);
  if (matches.length === 0) return `「${target}」という表示名のユーザーが見つかりませんでした。`;

  const lines = await Promise.all(
    matches.slice(0, 5).map(async (m) => {
      const role = await getUserRole(db, m.lineUserId);
      return `・${m.displayName}（${shortId(m.lineUserId)}）: **${ROLE_LABEL[role]}**`;
    })
  );
  return `「${target}」の検索結果:\n\n${lines.join("\n")}`;
}

// ─── 保留フローの応答処理 ─────────────────────────────────────────────────────

const YES_RE = /^(はい|yes|ok|確認|OK|よい|いいよ|よし)$/iu;
const CANCEL_RE = /^(キャンセル|いいえ|no|やめ|やめて|やめる|cancel)$/iu;
const NUMBER_RE = /^\s*([1-9]\d?)\s*(?:番)?\s*$/u;

export async function tryConsumePendingPermOp(input: {
  db: Db;
  actorUserId: string;
  text: string;
}): Promise<{ handled: boolean; reply: string }> {
  const { db, actorUserId, text } = input;
  const t = text.normalize("NFKC").trim();

  const pending = await getPendingPermOp(db, actorUserId);
  if (!pending) return { handled: false, reply: "" };

  // キャンセル
  if (CANCEL_RE.test(t)) {
    await deletePendingPermOp(db, actorUserId);
    return { handled: true, reply: "権限操作をキャンセルしました。" };
  }

  // --- pick ステージ: 番号を受け取る ---
  if (pending.stage === "pick") {
    const numMatch = t.match(NUMBER_RE);
    if (!numMatch) {
      return {
        handled: true,
        reply: `番号（1〜${pending.candidates.length}）か「キャンセル」を送ってください。`,
      };
    }
    const idx = parseInt(numMatch[1]!, 10) - 1;
    const chosen = pending.candidates[idx];
    if (!chosen) {
      return {
        handled: true,
        reply: `1〜${pending.candidates.length} の番号を入力してください。`,
      };
    }
    // 確認ステージへ移行
    await savePendingPermOp(db, {
      ...pending,
      stage: "confirm",
      targetLineUserId: chosen.lineUserId,
      targetDisplayName: chosen.displayName,
    });
    return {
      handled: true,
      reply: buildConfirmMessage(chosen.displayName, pending.opType, pending.role),
    };
  }

  // --- confirm ステージ: はい / キャンセル ---
  if (pending.stage === "confirm") {
    if (!YES_RE.test(t)) {
      return {
        handled: true,
        reply: `「はい」か「キャンセル」で答えてください。\n（確認: **${pending.targetDisplayName ?? "?"}** 様への ${pending.opType === "grant" ? `${ROLE_LABEL[pending.role ?? "member"]} 権限付与` : "権限削除"}）`,
      };
    }

    // 実行
    await deletePendingPermOp(db, actorUserId);
    const targetId = pending.targetLineUserId!;
    const displayName = pending.targetDisplayName ?? shortId(targetId);

    if (pending.opType === "grant") {
      const role = pending.role!;
      const actorRole = await getUserRole(db, actorUserId);
      if (!canGrantRole(actorRole, role)) {
        return { handled: true, reply: `権限が変わったため、この操作は実行できませんでした。` };
      }
      const currentRole = await getUserRole(db, targetId);
      await upsertUserRole(db, targetId, role, actorUserId, pending.notes);
      log.info({ targetId, role, actorUserId }, "user role granted (via name search)");
      return {
        handled: true,
        reply: `${displayName} 様の権限を **${ROLE_LABEL[currentRole]}** → **${ROLE_LABEL[role]}** に変更しました。${pending.notes ? `\nメモ: ${pending.notes}` : ""}`,
      };
    } else {
      const actorRole = await getUserRole(db, actorUserId);
      const currentRole = await getUserRole(db, targetId);
      if (currentRole === "guest") {
        return { handled: true, reply: `${displayName} 様はすでにゲストです。` };
      }
      if (!canGrantRole(actorRole, currentRole)) {
        return { handled: true, reply: `その権限レベルは削除できません。` };
      }
      await deleteUserRole(db, targetId);
      log.info({ targetId, actorUserId }, "user role revoked (via name search)");
      return {
        handled: true,
        reply: `${displayName} 様の権限（${ROLE_LABEL[currentRole]}）を削除し、ゲストに戻しました。`,
      };
    }
  }

  return { handled: false, reply: "" };
}

// ─── コマンド検出 ─────────────────────────────────────────────────────────────

const GRANT_RE = /^権限付与\s+(.+)$/u;
const REVOKE_RE = /^権限削除\s+(.+)$/u;
const LIST_RE = /^権限一覧$/u;
const CHECK_RE = /^権限確認\s+(.+)$/u;

function isPermissionCommand(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  return GRANT_RE.test(t) || REVOKE_RE.test(t) || LIST_RE.test(t) || CHECK_RE.test(t);
}

/**
 * 権限管理コマンドを処理する（admin 以上のみ）。
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

  const grantMatch = t.match(GRANT_RE);
  if (grantMatch) {
    const parts = grantMatch[1]!.trim().split(/\s+/);
    return { handled: true, reply: await handleGrant(db, actorUserId, actorRole, parts) };
  }

  const revokeMatch = t.match(REVOKE_RE);
  if (revokeMatch) {
    const parts = revokeMatch[1]!.trim().split(/\s+/);
    return { handled: true, reply: await handleRevoke(db, actorUserId, actorRole, parts) };
  }

  if (LIST_RE.test(t)) {
    return { handled: true, reply: await handleList(db) };
  }

  const checkMatch = t.match(CHECK_RE);
  if (checkMatch) {
    const parts = checkMatch[1]!.trim().split(/\s+/);
    return { handled: true, reply: await handleCheck(db, parts) };
  }

  return { handled: false, reply: "" };
}
