import type { UserRole } from "../db/user_roles_repo.js";
import type { IntentName } from "../models/intent.js";

/** 権限レベルの数値（比較用） */
export const ROLE_LEVEL: Record<UserRole, number> = {
  guest: 1,
  member: 2,
  admin: 3,
  developer: 4,
};

export const ROLE_LABEL: Record<UserRole, string> = {
  guest: "ゲスト",
  member: "メンバー",
  admin: "管理者",
  developer: "開発者",
};

/** intent ごとに必要な最低権限 */
const INTENT_REQUIRED_ROLE: Partial<Record<IntentName, UserRole>> = {
  greeting: "guest",
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

/** developer が別の developer を付与できないガード */
export function canGrantRole(granterRole: UserRole, targetRole: UserRole): boolean {
  if (granterRole === "developer") return true;
  if (granterRole === "admin") return ROLE_LEVEL[targetRole] <= ROLE_LEVEL["member"];
  return false;
}

/** 権限不足時のメッセージ */
export function insufficientRoleMessage(required: UserRole): string {
  const label = ROLE_LABEL[required];
  return `その機能は **${label}以上** の権限が必要です。\n権限の付与については管理者か開発者にご連絡ください。`;
}
