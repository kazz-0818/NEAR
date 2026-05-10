import { getEnv } from "../config/env.js";

/** Issue/PR 本文・LINE 用のローカル同期ブロック（パスは環境で上書き可） */
export function growthLocalSyncMarkdownSection(): string {
  const dir = getEnv().NEAR_LOCAL_SYNC_PATH_HINT.replace(/\/$/, "");
  const branch = getEnv().GROWTH_MERGE_TARGET_BRANCH;
  return [
    "## ローカル同期ルール",
    "",
    `このPRが${branch}へマージされた後、ローカル環境は自動更新されません。`,
    "PCを閉じている間は `git pull` も実行されません。",
    "",
    "次にCursorでNEARを触る前に、以下を実行してください。",
    "",
    "```bash",
    `cd ${dir}`,
    `git pull origin ${branch}`,
    "git status",
    "```",
    "",
  ].join("\n");
}

export function growthLocalSyncLineBlock(): string {
  const dir = getEnv().NEAR_LOCAL_SYNC_PATH_HINT.replace(/\/$/, "");
  const branch = getEnv().GROWTH_MERGE_TARGET_BRANCH;
  return [
    "ローカル同期コマンド:",
    `cd ${dir}`,
    `git pull origin ${branch}`,
    "git status",
    "",
    "※ Mac 上のフォルダは GitHub の更新と自動では同期されません。",
    "次にCursorでNEARを触る前に、上記を実行してください。",
  ].join("\n");
}

export function formatNearEvolutionCompleteLineMessage(input: {
  prUrl: string;
  issueUrl: string | null;
  commitShaShort: string;
}): string {
  const issueBlock =
    input.issueUrl && input.issueUrl.startsWith("http")
      ? `Issue:\n${input.issueUrl}\n\n`
      : "";
  return [
    "NEARの進化が完了しました。",
    "",
    `GitHub ${getEnv().GROWTH_MERGE_TARGET_BRANCH} が更新されています。`,
    "",
    "PR:",
    input.prUrl,
    "",
    issueBlock,
    "最新コミット:",
    input.commitShaShort,
    "",
    growthLocalSyncLineBlock(),
  ].join("\n");
}
