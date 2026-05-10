import { getEnv } from "../config/env.js";
import { growthLocalSyncMarkdownSection } from "../lib/growthLocalSyncText.js";
import { createGrowthIssue } from "./githubIssueService.js";
import { parseGrowthGithubIssueLabels, redactSecretsForGithubIssueBody } from "./growth_github_issue.js";
import type { ImprovementCapsuleRow } from "./improvement_capsule_repo.js";

export function buildImprovementCapsuleIssueTitle(row: ImprovementCapsuleRow): string {
  const base = (row.problem_summary ?? "").split(/\n/)[0]?.trim() || "NEAR 会話品質の改善";
  const clipped = base.length > 72 ? `${base.slice(0, 70)}…` : base;
  return `[NEAR改善] ${clipped}`;
}

export function buildImprovementCapsuleIssueBody(row: ImprovementCapsuleRow): string {
  const sync = growthLocalSyncMarkdownSection();
  const reqs = Array.isArray(row.suggested_requirements)
    ? (row.suggested_requirements as string[])
    : typeof row.suggested_requirements === "string"
      ? [row.suggested_requirements]
      : [];
  const reqBullets = reqs.length ? reqs.map((r) => `- ${r}`).join("\n") : "- （未指定）";
  const src = (row.source_candidate_ids ?? []).join(", ") || "（なし）";
  const raw = [
    "# NEAR Improvement Capsule",
    "",
    "## capsule_id",
    String(row.capsule_id),
    "",
    "## 問題タイプ",
    row.problem_type,
    "",
    "## 会話概要",
    row.context_summary,
    "",
    "## 検知内容",
    row.problem_summary,
    "",
    "## 改善案",
    row.improvement_proposal,
    "",
    "## 実装要件",
    reqBullets,
    "",
    "## 参考候補ID",
    src,
    "",
    "## 禁止事項",
    "- mainへ直接pushしない",
    "- secrets/env/APIキーを出力しない",
    "- 既存のタスク/Sheets/Growth/PR反映フローを壊さない",
    "- 不要な大規模リファクタリングをしない",
    "- package-lock.jsonを不要に変更しない",
    "",
    "## テスト",
    "- npm run build を通す",
    "- 関連する会話パターンのテストを追加する",
    "- 既存主要フローを壊さない",
    "",
    "## 完了条件",
    "- 検知された問題が再発しにくくなる",
    "- 該当パターンのテストが追加される",
    "- npm run build が通る",
    "",
    sync,
  ].join("\n");
  return redactSecretsForGithubIssueBody(raw);
}

export function improvementCapsuleIssueLabels(): string[] {
  const env = getEnv();
  const base = parseGrowthGithubIssueLabels(env.GROWTH_GITHUB_ISSUE_LABELS);
  return [...new Set([...base, "near-growth", "cursor-agent", "improvement-capsule"])];
}

export async function createGithubIssueForImprovementCapsule(row: ImprovementCapsuleRow): Promise<{ issueUrl: string; issueNumber: number }> {
  const title = buildImprovementCapsuleIssueTitle(row);
  const body = buildImprovementCapsuleIssueBody(row);
  return createGrowthIssue({
    suggestionId: `capsule-${row.capsule_id}`,
    title,
    body,
    labels: improvementCapsuleIssueLabels(),
  });
}
