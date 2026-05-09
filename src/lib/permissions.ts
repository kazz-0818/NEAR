import type { UserRole } from "../db/user_roles_repo.js";
import type { IntentName } from "../models/intent.js";

/** 権限レベルの数値（比較用） */
export const ROLE_LEVEL: Record<UserRole, number> = {
  restricted: 0,
  guest: 1,
  member: 2,
  admin: 3,
  developer: 4,
};

export const ROLE_LABEL: Record<UserRole, string> = {
  restricted: "制限ユーザー",
  guest: "ゲスト",
  member: "メンバー",
  admin: "管理者",
  developer: "開発者",
};

/** intent ごとに必要な最低権限 */
const INTENT_REQUIRED_ROLE: Partial<Record<IntentName, UserRole>> = {
  greeting: "restricted", // 【動作確認】挨拶のみは制限ユーザーも可
  simple_question: "guest",
  help_capabilities: "guest",
  unknown_custom_request: "guest",
  task_create: "member",
  memo_save: "member",
  summarize: "member",
  reminder_request: "member",
  google_sheets_query: "member",
  google_calendar_query: "member",
};

/** このintentに必要な権限を返す（未定義は guest） */
export function requiredRoleForIntent(intent: IntentName): UserRole {
  return INTENT_REQUIRED_ROLE[intent] ?? "guest";
}

/** role が target 以上かどうか */
export function hasRole(role: UserRole, required: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

/** 権限付与ガード: admin は restricted〜member まで操作可、developer は全て操作可 */
export function canGrantRole(granterRole: UserRole, targetRole: UserRole): boolean {
  if (granterRole === "developer") return true;
  if (granterRole === "admin") return ROLE_LEVEL[targetRole] <= ROLE_LEVEL["member"];
  return false;
}

/** 権限不足時のメッセージ */
export function insufficientRoleMessage(required: UserRole): string {
  const label = ROLE_LABEL[required];
  return `その機能は **${label}以上** の権限が必要です。\n権限については管理者か開発者にご連絡ください。`;
}

/** 制限ユーザー向けのブロックメッセージ（定型・システム臭さ抑制用） */
export function restrictedBlockMessage(): string {
  return `申し訳ありません。現在その操作は許可されていません。`;
}
