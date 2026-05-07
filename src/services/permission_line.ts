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
import { stripBotNamePrefix } from "../channels/line/groupMention.js";

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
  notes: string | null,
  channelId: string
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
      channelId,
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
    channelId,
  });
  return buildPickMessage(candidates, opType, role);
}

// ─── コマンドパーサ ───────────────────────────────────────────────────────────

async function handleGrant(db: Db, actorUserId: string, actorRole: UserRole, parts: string[], channelId: string): Promise<string> {
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
  return startNameSearchFlow(db, actorUserId, actorRole, "grant", target, targetRole, notes, channelId);
}

async function handleRevoke(db: Db, actorUserId: string, actorRole: UserRole, parts: string[], channelId: string): Promise<string> {
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
  return startNameSearchFlow(db, actorUserId, actorRole, "revoke", target, null, null, channelId);
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
const CANCEL_RE = /^(キャンセル|いいえ|no|やめ|やめて|やめる|cancel|取り消し|取消|やっぱり(いい|なし|やめ))$/iu;
const NUMBER_RE = /^\s*([1-9]\d?)\s*(?:番)?\s*$/u;

/**
 * 権限フローへの応答としては明らかに無関係な入力かを判定。
 * - 15文字超 → 別の依頼の可能性が高い
 * - 短くても「〜して」「〜出して」「〜教えて」などの依頼語尾があれば不関係
 */
function isLikelyUnrelated(t: string): boolean {
  if (t.length > 15) return true;
  return /(?:して|出して|教えて|見せて|調べて|探して|売り?上げ|シート|スプレ|確認して)/.test(t);
}

export async function tryConsumePendingPermOp(input: {
  db: Db;
  actorUserId: string;
  channelId: string;
  text: string;
}): Promise<{ handled: boolean; reply: string }> {
  const { db, actorUserId, channelId, text } = input;
  // グループでは「ニア メンバー」のように bot 名が付く → 除去してから判定
  const t = stripBotNamePrefix(text).normalize("NFKC").trim();

  const pending = await getPendingPermOp(db, actorUserId, channelId);
  if (!pending) return { handled: false, reply: "" };

  // キャンセル
  if (CANCEL_RE.test(t)) {
    await deletePendingPermOp(db, actorUserId);
    return { handled: true, reply: "権限操作をキャンセルしました。" };
  }

  // --- await_role ステージ: ロール名を受け取る ---
  if (pending.stage === "await_role") {
    const roleParsed = parseRole(t);
    if (!roleParsed) {
      if (isLikelyUnrelated(t)) {
        await deletePendingPermOp(db, actorUserId);
        log.info({ actorUserId, t }, "await_role auto-cancelled: unrelated message");
        return { handled: false, reply: "" };
      }
      return {
        handled: true,
        reply: `「${t}」はレベルとして認識できませんでした。\n\`guest\` / \`member\`（一般）/ \`admin\`（管理者）/ \`developer\` のいずれかを送ってください。\nキャンセルは「キャンセル」。`,
      };
    }
    const nameQuery = pending.notes ?? "";
    await deletePendingPermOp(db, actorUserId);
    const actorRole = await getUserRole(db, actorUserId);
    const reply = await startNameSearchFlow(db, actorUserId, actorRole, "grant", nameQuery, roleParsed, null, channelId);
    return { handled: true, reply };
  }

  // --- pick ステージ: 番号を受け取る ---
  if (pending.stage === "pick") {
    const numMatch = t.match(NUMBER_RE);
    if (!numMatch) {
      if (isLikelyUnrelated(t)) {
        await deletePendingPermOp(db, actorUserId);
        return { handled: false, reply: "" };
      }
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
      if (isLikelyUnrelated(t)) {
        await deletePendingPermOp(db, actorUserId);
        return { handled: false, reply: "" };
      }
      const opDesc = pending.opType === "grant"
        ? `${ROLE_LABEL[pending.role ?? "member"]} 権限付与`
        : "権限削除";
      return {
        handled: true,
        reply: `「はい」か「キャンセル」で答えてください。\n（**${pending.targetDisplayName ?? "?"}** 様への ${opDesc}）`,
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

// 自然言語パターン
// 「ゆうすけの権限を変えたい」「田中さんにメンバー権限」「権限変更」など
const PERM_KEYWORD_RE = /権限(?:付与|削除|変更|確認|一覧|を変|に変|を付|を削|を教|を見|一覧)/u;
const PERM_NATURAL_RE =
  /(.{1,20}?)(?:さん|様|くん|ちゃん)?\s*の?\s*権限(?:を|に)?(?:変え|付け|付与|削除|変更|教え|確認|上げ|下げ|外し|はず)|権限(?:変更|付与|削除|確認)|(.{1,20}?)(?:さん|様)?\s*(?:に|の)\s*(?:メンバー|管理者|ゲスト|developer|admin|member|guest)\s*権限/ui;

function isPermissionCommand(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  return (
    GRANT_RE.test(t) ||
    REVOKE_RE.test(t) ||
    LIST_RE.test(t) ||
    CHECK_RE.test(t) ||
    PERM_KEYWORD_RE.test(t) ||
    PERM_NATURAL_RE.test(t)
  );
}

const PERM_HELP = `権限管理コマンドの使い方:

**付与:** \`権限付与 {名前または userId} {レベル}\`
　例: \`権限付与 ゆうすけ member\`

**削除:** \`権限削除 {名前または userId}\`
　例: \`権限削除 田中\`

**一覧:** \`権限一覧\`

**確認:** \`権限確認 {名前または userId}\`

レベル: \`guest\`（閲覧のみ）/ \`member\`（一般）/ \`admin\`（管理者）/ \`developer\`（開発者）`;

/**
 * 自然言語から「誰の権限をどうしたいか」をざっくり解釈してコマンドに変換する。
 * 完全な解釈ができない場合はヘルプと入力ガイドを返す。
 */
function tryParseNaturalPermCommand(t: string): {
  op: "grant" | "revoke" | "list" | "check" | "help";
  name?: string;
  role?: UserRole | null;
} {
  // 一覧系
  if (/権限一覧|権限.*一覧|一覧.*権限/u.test(t)) return { op: "list" };

  // ロール名が含まれる → grant 判断
  const roleInText = Object.keys(ROLE_ALIASES).find((k) =>
    new RegExp(k, "iu").test(t)
  );
  const role: UserRole | null = roleInText ? (parseRole(roleInText) ?? null) : null;

  // 名前の抽出:「Xの権限」「Xに権限」「Xさん」等のパターン。
  // [にへをのがは] は助詞であり名前に含めない（キャプチャ群の外に配置）。
  const nameMatch =
    t.match(/^(.{1,20}?)(?:さん|様|くん|ちゃん)?\s*[にへをのがは]?\s*権限/u) ??
    t.match(/^(.{1,20}?)(?:さん|様|くん|ちゃん)\s*(?:に|の)/u);
  // 末尾に助詞・敬称が残っていればトリム（lazy match の取り残し対策）
  const name = nameMatch?.[1]?.replace(/[にへをのがは]\s*$/u, "").trim();

  // 削除系キーワード
  if (/削除|外し|はず|取り消し|取消|remove|revoke/iu.test(t)) {
    return { op: "revoke", name };
  }

  // 確認系
  if (/確認|確かめ|調べ|見せ|教え/u.test(t) && !role) {
    return { op: "check", name };
  }

  // 名前もロールも取れた → grant
  if (name && role) return { op: "grant", name, role };

  // 名前だけ取れた → 何にするか聞き返す
  if (name) return { op: "help", name };

  return { op: "help" };
}

/**
 * 権限管理コマンドを処理する（admin 以上のみ）。
 */
export async function tryHandlePermissionLine(input: {
  db: Db;
  actorUserId: string;
  channelId: string;
  text: string;
}): Promise<{ handled: boolean; reply: string }> {
  const { db, actorUserId, channelId, text } = input;
  // グループでは「ニア　ザキの権限変更」のように bot 名が先頭に付く → 除去してから判定
  const t = stripBotNamePrefix(text).normalize("NFKC").trim();

  if (!isPermissionCommand(t)) return { handled: false, reply: "" };

  const actorRole = await getUserRole(db, actorUserId);
  if (!hasRole(actorRole, "admin")) {
    return {
      handled: true,
      reply: "権限管理コマンドは **管理者（admin）以上** のみ使用できます。",
    };
  }

  // 厳密コマンドを先に処理
  const grantMatch = t.match(GRANT_RE);
  if (grantMatch) {
    const parts = grantMatch[1]!.trim().split(/\s+/);
    return { handled: true, reply: await handleGrant(db, actorUserId, actorRole, parts, channelId) };
  }

  const revokeMatch = t.match(REVOKE_RE);
  if (revokeMatch) {
    const parts = revokeMatch[1]!.trim().split(/\s+/);
    return { handled: true, reply: await handleRevoke(db, actorUserId, actorRole, parts, channelId) };
  }

  if (LIST_RE.test(t)) {
    return { handled: true, reply: await handleList(db) };
  }

  const checkMatch = t.match(CHECK_RE);
  if (checkMatch) {
    const parts = checkMatch[1]!.trim().split(/\s+/);
    return { handled: true, reply: await handleCheck(db, parts) };
  }

  // 自然言語コマンドの解釈
  const parsed = tryParseNaturalPermCommand(t);

  if (parsed.op === "list") {
    return { handled: true, reply: await handleList(db) };
  }

  if (parsed.op === "check" && parsed.name) {
    return { handled: true, reply: await handleCheck(db, [parsed.name]) };
  }

  if (parsed.op === "grant" && parsed.name && parsed.role) {
    return { handled: true, reply: await handleGrant(db, actorUserId, actorRole, [parsed.name, parsed.role], channelId) };
  }

  if (parsed.op === "revoke" && parsed.name) {
    return { handled: true, reply: await handleRevoke(db, actorUserId, actorRole, [parsed.name], channelId) };
  }

  // 名前は取れたがロールが不明の場合 → await_role ステージを保存して聞き返す
  if (parsed.name) {
    await savePendingPermOp(db, {
      actorLineUserId: actorUserId,
      opType: "grant",
      stage: "await_role",
      candidates: [],
      targetLineUserId: null,
      targetDisplayName: null,
      role: null,
      notes: parsed.name,
      channelId,
    });
    return {
      handled: true,
      reply:
        `**${parsed.name}** さんの権限を変更しますね。どのレベルにしますか？\n\n` +
        `\`guest\` / \`member\`（一般）/ \`admin\`（管理者）/ \`developer\`\n\n` +
        `例: \`member\` とだけ送ってください。キャンセルは「キャンセル」。`,
    };
  }

  // どれにも合わなかった → ヘルプ
  return { handled: true, reply: PERM_HELP };
}
