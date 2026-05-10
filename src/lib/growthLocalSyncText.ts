import { getEnv } from "../config/env.js";

const MARKER_NEAR_AUTOMATION_PR = "<!-- NEAR_GROWTH_AUTOMATION_PR -->";

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
    "ローカルに未コミットの変更がある場合は、先に `git commit` するか `git stash` してから pull してください。",
    "",
  ].join("\n");
}

/** LINE 用: 同期コマンド＋注意（進化完了通知で使用） */
export function growthLocalSyncLineBlock(): string {
  const dir = getEnv().NEAR_LOCAL_SYNC_PATH_HINT.replace(/\/$/, "");
  const branch = getEnv().GROWTH_MERGE_TARGET_BRANCH;
  return [
    "ローカル同期コマンド:",
    `cd ${dir}`,
    `git pull origin ${branch}`,
    "git status",
    "",
    "PCを閉じている間はローカルには自動反映されないため、次にCursorを開く前に上記コマンドを実行してください。",
    "",
    "ローカルに未コミットの変更がある場合は、先に commit するか stash してから pull してください。",
  ].join("\n");
}

/**
 * 管理者 LINE: 進化完了＋ローカル同期案内（Issue URL は含めない。トークン類は呼び出し側でマスク済みであること）
 */
export function formatNearEvolutionCompleteLineMessage(input: {
  prUrl: string;
  commitShaShort: string;
}): string {
  return [
    "NEARの進化が完了しました。",
    "",
    "最新コミット:",
    input.commitShaShort,
    "",
    "GitHub:",
    input.prUrl,
    "",
    growthLocalSyncLineBlock(),
  ].join("\n");
}

export { MARKER_NEAR_AUTOMATION_PR };
