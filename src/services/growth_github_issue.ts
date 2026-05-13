import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import { growthLocalSyncMarkdownSection } from "../lib/growthLocalSyncText.js";
import { buildFinalCursorPrompt } from "./cursor_prompt_builder.js";
import { createGrowthIssue, GrowthGithubIssueError } from "./githubIssueService.js";

const log = getLogger();

const GITHUB_ISSUE_BODY_MAX = 65000;

/** 手動テスト手順（Growth Issue）:
 * A. GROWTH_AUTO_ISSUE_ENABLED=true で管理者 LINE に「suggestion {id} 実装依頼して」→ Issue 作成・DB・返信 URL を確認。
 * B. 同じ文言を再送 → 重複せず既存 URL のみ返ることを確認。
 * C. GITHUB_TOKEN 未設定 → 失敗メッセージ（トークン値は出ない）。
 * D. GROWTH_GITHUB_REPO を不正な形式に → 失敗メッセージと確認リストが返ることを確認。
 */

export function parseGrowthGithubIssueLabels(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Issue 本文に混入しうる秘密情報を最低限マスクする（完全ではない）。
 */
export function redactSecretsForGithubIssueBody(text: string): string {
  let out = text;
  out = out.replace(/\bghp_[a-zA-Z0-9]{20,}\b/g, "[REDACTED]");
  out = out.replace(/\bgho_[a-zA-Z0-9]{20,}\b/g, "[REDACTED]");
  out = out.replace(/\bghu_[a-zA-Z0-9]{20,}\b/g, "[REDACTED]");
  out = out.replace(/\bgithub_pat_[a-zA-Z0-9_]+\b/gi, "[REDACTED]");
  out = out.replace(/\bxox[baprs]-[a-zA-Z0-9-]+\b/g, "[REDACTED]");
  out = out.replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/OPENAI_API_KEY\s*[=:]\s*\S+/gi, "OPENAI_API_KEY=[REDACTED]");
  out = out.replace(/GITHUB_TOKEN\s*[=:]\s*\S+/gi, "GITHUB_TOKEN=[REDACTED]");
  out = out.replace(/DATABASE_URL\s*[=:]\s*\S+/gi, "DATABASE_URL=[REDACTED]");
  out = out.replace(/postgresql:\/\/[^\s"'<>]+/gi, "[REDACTED_DB_URL]");
  out = out.replace(/mongodb(\+srv)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DB_URL]");
  out = out.replace(/\bapi[_-]?key\s*[=:]\s*\S+/gi, "api_key=[REDACTED]");
  out = out.replace(/\bpassword\s*[=:]\s*\S+/gi, "password=[REDACTED]");
  out = out.replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  return out;
}

function jString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

function formatSteps(steps: unknown): string {
  if (steps == null || steps === "") return "（未設定）";
  if (Array.isArray(steps)) {
    return steps
      .map((x, i) => {
        const line = typeof x === "string" ? x : JSON.stringify(x);
        return `${i + 1}. ${line}`;
      })
      .join("\n");
  }
  return jString(steps);
}

export async function buildGrowthGithubIssueMarkdown(db: Db, suggestionId: number): Promise<{ title: string; body: string }> {
  const r = await db.query(
    `SELECT s.summary, s.steps, s.suggested_modules, s.required_apis,
            u.original_message, u.detected_intent AS unsupported_intent
     FROM near_implementation_suggestions s
     JOIN near_unsupported_requests u ON u.id = s.unsupported_request_id
     WHERE s.id = $1`,
    [suggestionId]
  );
  if (r.rows.length === 0) throw new Error("suggestion not found");
  const row = r.rows[0] as Record<string, unknown>;

  const summary = String(row.summary ?? "").trim() || "（要約なし）";
  const original = String(row.original_message ?? "").trim();
  const intent = String(row.unsupported_intent ?? "unknown_custom_request");

  const cursorPromptRaw = await buildFinalCursorPrompt(db, suggestionId);
  const cursorPrompt = redactSecretsForGithubIssueBody(cursorPromptRaw);

  const stepsBlock = formatSteps(row.steps);
  const implReqBullets = [
    "- 要望内容を満たす最小差分で実装する",
    "- 既存のLINE返信、タスク管理、スプレッドシート連携、成長システムを壊さない",
    "- 必要に応じて既存モジュールへ統合する",
    "- 破壊的変更は避ける",
    stepsBlock !== "（未設定）" ? `- （LLM が提案した実装ステップ）\n${stepsBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts = [
    "# NEAR Growth Request",
    "",
    "_この Issue は NEAR 成長システムから自動作成されています。GitHub Actions の Cursor Agent が読みます。_",
    "",
    "## suggestion_id",
    String(suggestionId),
    "",
    "## 元の要望",
    original.slice(0, 4000) || "（ユーザー原文なし）",
    "",
    "## 目的",
    "この要望をNEARの機能として実装する。",
    "",
    "## 現状",
    "現在のNEARでは、この要望に完全対応できていない。",
    `（起点 intent 案: \`${intent}\`）`,
    "",
    "## 実装要件（要約・ステップ）",
    summary,
    "",
    implReqBullets,
    "",
    "## 変更対象ファイル候補",
    "- `src/services/` …（該当ロジック・通知・オーケストレーション）",
    "- `src/modules/` …（intent ハンドラ・ツール連携）",
    "- `src/agent/` …（エージェント経路・ツール）",
    "- `src/models/intent.ts` …（分類・JSON schema が変わる場合）",
    "- `prompts/*.md` …（分類・応答プロンプト）",
    "- `src/db/migrations/*.sql` …（永続化が必要な場合）",
    "",
    "### suggested_modules（JSON）",
    jString(row.suggested_modules) || "（なし）",
    "",
    "### required_apis（JSON）",
    jString(row.required_apis) || "（なし）",
    "",
    "## 禁止事項",
    "- mainへ直接pushしない",
    "- secrets/env/APIキーを出力しない",
    "- 不要な大規模リファクタリングをしない",
    "- package-lock.json を不要に変更しない",
    "",
    "## テスト",
    "- `npm run build` を通す",
    "- 既存の主要フローを壊さない（LINE・タスク・シート・グループメンションルール）",
    "",
    "## 完了条件",
    "- 要望に対する実装が入っている",
    "- `npm run build` が通る",
    "- PRが作成される",
    "",
    growthLocalSyncMarkdownSection(),
    "## Cursor用プロンプト全文（詳細）",
    "```markdown",
    cursorPrompt,
    "```",
    "",
    "## 作業メモ（自動生成）",
    "- Actions ラベル **near-growth** / **cursor-agent** が付与されていること",
    "- PR・Issue に suggestion_id を記載すること",
  ];

  let body = bodyParts.join("\n");
  if (body.length > GITHUB_ISSUE_BODY_MAX) {
    body =
      body.slice(0, GITHUB_ISSUE_BODY_MAX - 200) +
      "\n\n…(truncated for GitHub issue body limit; 管理APIで cursor_prompt 全文を確認できます)";
  }

  const title = `[NEAR Growth] suggestion #${suggestionId}: ${summary.slice(0, 120)}`;
  return { title, body };
}

async function persistGrowthIssueSuccess(
  db: Db,
  suggestionId: number,
  issueNumber: number,
  issueUrl: string
): Promise<void> {
  await db.query(
    `UPDATE near_implementation_suggestions
     SET github_issue_url = $1,
         github_issue_number = $2,
         github_issue_status = 'open',
         coding_status = 'github_issue_created',
         coding_failure_reason = NULL,
         issue_created_at = now(),
         updated_at = now()
     WHERE id = $3`,
    [issueUrl, issueNumber, suggestionId]
  );
}

async function persistGrowthIssueFailure(db: Db, suggestionId: number, reason: string): Promise<void> {
  await db.query(
    `UPDATE near_implementation_suggestions
     SET coding_failure_reason = $1,
         coding_status = COALESCE(coding_status, 'github_issue_failed'),
         updated_at = now()
     WHERE id = $2`,
    [reason.slice(0, 4000), suggestionId]
  );
}

export type EnsureGrowthIssueResult =
  | { ok: true; created: boolean; issueUrl: string; issueNumber?: number }
  | { ok: false; message: string };

/**
 * GitHub Issue が未作成なら作成し DB に保存する。既に URL がある場合は作成しない。
 * GROWTH_AUTO_ISSUE_ENABLED はここでは見ない（LINE 側・運用ポリシーで制御）。
 */
export async function ensureGithubIssueForSuggestion(db: Db, suggestionId: number): Promise<EnsureGrowthIssueResult> {
  const env = getEnv();
  const repo = env.GROWTH_GITHUB_REPO ?? "";

  const existing = await db.query<{ github_issue_url: string | null }>(
    `SELECT github_issue_url FROM near_implementation_suggestions WHERE id = $1`,
    [suggestionId]
  );
  const existingUrl = existing.rows[0]?.github_issue_url?.trim();
  if (existingUrl) {
    const numRow = await db.query<{ n: string | null }>(
      `SELECT github_issue_number::text AS n FROM near_implementation_suggestions WHERE id = $1`,
      [suggestionId]
    );
    const issueNumRaw = numRow.rows[0]?.n;
    const issueNumber =
      issueNumRaw != null && issueNumRaw !== "" && Number.isFinite(Number(issueNumRaw))
        ? Number(issueNumRaw)
        : undefined;
    log.info(
      { suggestionId, repo, issueTitle: "(skipped)", success: true, issueUrl: existingUrl },
      "growth github issue: already exists"
    );
    return { ok: true, created: false, issueUrl: existingUrl, issueNumber };
  }

  let title = "";
  try {
    const built = await buildGrowthGithubIssueMarkdown(db, suggestionId);
    title = built.title;
    const parsedLabels = parseGrowthGithubIssueLabels(env.GROWTH_GITHUB_ISSUE_LABELS);
    const labels = parsedLabels.length ? parsedLabels : ["near-growth", "cursor-agent"];

    const { issueNumber, issueUrl } = await createGrowthIssue({
      suggestionId,
      title: built.title,
      body: built.body,
      labels,
    });

    await persistGrowthIssueSuccess(db, suggestionId, issueNumber, issueUrl);

    log.info({ suggestionId, repo, issueTitle: title, success: true, issueUrl }, "growth github issue");

    return { ok: true, created: true, issueUrl, issueNumber };
  } catch (e) {
    const msg = e instanceof GrowthGithubIssueError ? e.message : e instanceof Error ? e.message : String(e);
    await persistGrowthIssueFailure(db, suggestionId, msg);

    log.warn(
      { suggestionId, repo, issueTitle: title || "(build failed)", success: false, issueUrl: "", err: msg },
      "growth github issue"
    );

    return { ok: false, message: msg };
  }
}

export function formatLineGrowthIssueSuccessReply(issueUrl: string, issueNumber?: number): string {
  const lines: string[] = ["GitHub Issueを作成しました。"];
  if (issueNumber != null && Number.isFinite(issueNumber)) {
    lines.push("", `Issue #${issueNumber}`, "");
  }
  lines.push(
    issueUrl,
    "",
    "このあとGitHub Actionsが起動し、Cursor Agentが実装PRを作成します。",
    "PRができたら確認してください。"
  );
  return lines.join("\n");
}

export function formatLineGrowthIssueFailureReply(reason: string): string {
  return [
    "GitHub Issueの作成に失敗しました。",
    "",
    "原因:",
    reason,
    "",
    "確認してください:",
    "- GITHUB_TOKEN が設定されているか",
    "- GROWTH_GITHUB_REPO が owner/repo 形式か",
    "- GitHub Token に Issue 作成権限があるか",
    "- 対象リポジトリにアクセスできるか",
  ].join("\n");
}
