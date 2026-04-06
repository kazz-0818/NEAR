import crypto from "node:crypto";
import { messageFingerprint } from "../lib/messageFingerprint.js";

/**
 * reason_code はカンマ連結がありうるため、安定キー用に正規化する。
 */
export function coarseReasonFamily(reasonCode: string): string {
  const parts = reasonCode
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)].sort().join(",") || "unknown";
}

/**
 * 同一チャネル・同一ユーザー発話（fingerprint）・同一 source・同一理由ファミリーで 1 バケット。
 * ゲートの `messageFingerprint(text)` と同じ正規化を userText に適用する。
 */
export function computeSignalBucketKey(
  channel: string,
  userText: string,
  source: string,
  reasonCode: string
): string {
  const fp = messageFingerprint(userText);
  const family = coarseReasonFamily(reasonCode);
  const payload = `${channel}\0${fp}\0${source}\0${family}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * 運用向けの粗い優先度（1〜100）。バケットの GREATEST と一覧ソートに使う。
 * 将来、自動昇格やアラート閾値の材料にする。
 */
export function computeSignalPriorityScore(source: string, reasonCode: string): number {
  const rc = reasonCode.toLowerCase();
  let base = 50;
  if (source === "faq_answerer") base = 82;
  else if (source === "legacy_module") base = 74;
  else if (source === "agent_path") base = 62;

  if (rc.includes("compose_error")) base += 12;
  if (rc.includes("soft_failure")) base += 6;
  if (rc.includes("no_tools")) base += 4;
  if (rc.includes("capability_deflection") || rc.includes("deflection")) base += 8;
  if (rc.includes("module_situation_error")) base += 10;

  return Math.min(100, Math.max(1, Math.round(base)));
}
