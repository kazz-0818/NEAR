import type { Db } from "../db/client.js";
import { listRegisteredIntents } from "../modules/registry.js";
import { hearingAnswersAsJson } from "./hearing_service.js";

type Json = Record<string, unknown>;

function jString(v: unknown, fallback = "[]"): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
}

/**
 * 第二承認後・実装投入用の Cursor 向け指示（コピペ1ブロック）。
 * 既存の cursor_prompt を土台に、ヒアリング結果と必須セクションを足す。
 */
export async function buildFinalCursorPrompt(db: Db, suggestionId: number): Promise<string> {
  const r = await db.query(
    `SELECT s.*, u.original_message, u.detected_intent, u.channel_user_id
     FROM implementation_suggestions s
     JOIN unsupported_requests u ON u.id = s.unsupported_request_id
     WHERE s.id = $1`,
    [suggestionId]
  );
  if (r.rows.length === 0) throw new Error("suggestion not found");
  const row = r.rows[0] as Json;

  const answers = await hearingAnswersAsJson(db, suggestionId);
  const answersBlock = Object.keys(answers).length
    ? Object.entries(answers)
        .map(([k, v]) => `- **${k}**: ${v}`)
        .join("\n")
    : "（ヒアリング回答なし）";

  const basePrompt = String(row.cursor_prompt ?? "").trim() || "（ベースの cursor_prompt 未設定）";
  const summary = String(row.summary ?? "");
  const intentGuess = String(row.detected_intent ?? "unknown_custom_request");
  const modules = jString(row.suggested_modules);
  const apis = jString(row.required_apis);
  const steps = jString(row.steps);
  const improvementKind = String(row.improvement_kind ?? "");
  const risk = String(row.risk_level ?? "");
  const effort = String(row.estimated_effort ?? "");

  const registered = listRegisteredIntents().join(", ");

  return [
    "# NEAR 成長タスク — Cursor 向け実装指示（自動生成）",
    "",
    "## 目的",
    summary,
    "",
    "## ユーザー原文（参考）",
    String(row.original_message ?? "").slice(0, 2000),
    "",
    "## 追加する intent 名（案）",
    `分類上の起点: \`${intentGuess}\` — 新規 intent が必要なら \`src/models/intent.ts\` の INTENT_NAMES と分類プロンプトを更新すること。`,
    "",
    "## 管理者ヒアリング結果（構造化）",
    answersBlock,
    "",
    "## 修正・追加の候補ファイル",
    "- `src/models/intent.ts`（intent / JSON schema）",
    "- `src/modules/registry.ts`（ハンドラ登録）",
    "- `src/modules/*.ts`（新規モジュール）",
    "- `prompts/*.md`（分類・応答プロンプト）",
    "- `src/db/migrations/*.sql`（永続化が必要な場合）",
    "- `src/services/orchestrator.ts`（ルーティングが変わる場合）",
    "",
    "## 想定モジュール（suggested_modules JSON）",
    modules,
    "",
    "## 外部 API（required_apis JSON）",
    apis,
    "",
    "## 必要な環境変数（新規があれば `.env.example` に追記）",
    "- 秘密はログに出さないこと。",
    "- OAuth / API キーは Render の Environment に登録。",
    "",
    "## 既存 intent 一覧（重複回避）",
    registered,
    "",
    "## 実装ステップ案（LLM 出力の steps）",
    steps,
    "",
    "## メタ情報",
    `- improvement_kind: ${improvementKind}`,
    `- risk_level: ${risk}`,
    `- estimated_effort: ${effort}`,
    `- unsupported_request channel_user_id（個人を特定しない運用）: 設計時は汎用化すること`,
    "",
    "## テスト方針",
    "- `npm run build` が通ること",
    "- 該当 intent の手動シナリオ（LINE またはユニット想定）で最低1系統",
    "- グループ時はメンション／NEAR 呼びかけルールを壊さないこと",
    "",
    "## 受け入れ条件",
    "- ユーザー依頼を安全な範囲で満たす、または明確にフォローアップ質問に落とす",
    "- 秘密をログ・返信に含めない",
    "- 未対応時は従来どおり unsupported ログ＋ユーザーへの丁寧な断り",
    "",
    "## デプロイ時の注意",
    "- マイグレーション追加時は `ensureSchema` 対象に含める",
    "- 本番の自動デプロイは `GROWTH_AUTO_DEPLOY_ENABLED` が true のときのみ runner が触る設計",
    "",
    "## ベース cursor_prompt（feature_suggester 出力）",
    basePrompt,
  ].join("\n");
}

export async function persistBuiltCursorPrompt(db: Db, suggestionId: number, text: string): Promise<void> {
  await db.query(
    `UPDATE implementation_suggestions SET cursor_prompt = $1, updated_at = now() WHERE id = $2`,
    [text, suggestionId]
  );
}
