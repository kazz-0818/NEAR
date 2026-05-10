import { getEnv } from "../config/env.js";
import { parseGithubRepo } from "../lib/githubRepo.js";
import { GrowthGithubIssueError } from "./githubIssueService.js";

export type GithubPullView = {
  number: number;
  html_url: string;
  state: string;
  merged?: boolean | null;
  merge_commit_sha?: string | null;
  mergeable: boolean | null;
  mergeable_state: string | null;
  body: string | null;
  base: { ref: string };
  head: { ref: string; sha: string };
};

function repoOrThrow(): { owner: string; repo: string } {
  const env = getEnv();
  const gh = parseGithubRepo(env.GROWTH_GITHUB_REPO);
  if (!gh) throw new GrowthGithubIssueError("GROWTH_GITHUB_REPO が owner/repo 形式ではありません");
  return gh;
}

function tokenOrThrow(): string {
  const env = getEnv();
  if (!env.GITHUB_TOKEN?.trim()) throw new GrowthGithubIssueError("GITHUB_TOKEN が未設定です");
  return env.GITHUB_TOKEN.trim();
}

async function githubJson<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const token = tokenOrThrow();
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (typeof j.message === "string" && j.message.length) detail += `: ${j.message.slice(0, 400)}`;
    } catch {
      /* ignore */
    }
    throw new GrowthGithubIssueError(detail);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GrowthGithubIssueError("GitHub API の JSON を解釈できませんでした");
  }
}

export async function githubGetPullRequest(prNumber: number): Promise<GithubPullView> {
  const { owner, repo } = repoOrThrow();
  return githubJson<GithubPullView>("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
}

export async function githubListOpenPullsByHead(headFull: string): Promise<GithubPullView[]> {
  const { owner, repo } = repoOrThrow();
  const q = new URLSearchParams({ state: "open", head: headFull, per_page: "5" });
  return githubJson<GithubPullView[]>("GET", `/repos/${owner}/${repo}/pulls?${q.toString()}`);
}

export async function githubGetDefaultBranch(): Promise<string> {
  const { owner, repo } = repoOrThrow();
  const j = await githubJson<{ default_branch?: string }>("GET", `/repos/${owner}/${repo}`);
  const b = j.default_branch?.trim();
  if (!b) throw new GrowthGithubIssueError("default_branch を取得できませんでした");
  return b;
}

export async function githubGetBranchHeadSha(branch: string): Promise<string> {
  const { owner, repo } = repoOrThrow();
  const ref = encodeURIComponent(`heads/${branch}`);
  const j = await githubJson<{ object?: { sha?: string } }>("GET", `/repos/${owner}/${repo}/git/ref/${ref}`);
  const sha = j.object?.sha;
  if (!sha) throw new GrowthGithubIssueError(`ブランチ ${branch} の先端 SHA を取得できませんでした`);
  return sha;
}

type CheckRun = { conclusion: string | null; status: string; name?: string };

async function githubListCheckRunsForSha(sha: string): Promise<CheckRun[]> {
  const { owner, repo } = repoOrThrow();
  const out: CheckRun[] = [];
  let page = 1;
  for (;;) {
    const j = await githubJson<{ check_runs?: CheckRun[] }>(
      "GET",
      `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`
    );
    const runs = j.check_runs ?? [];
    out.push(...runs);
    if (runs.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return out;
}

/** GitHub Actions 等: failure / timed_out、または未完了のチェック */
export async function githubCheckRunSummary(headSha: string): Promise<{ failed: boolean; pending: boolean }> {
  const runs = await githubListCheckRunsForSha(headSha);
  let failed = false;
  let pending = false;
  for (const r of runs) {
    const st = r.status ?? "";
    if (st === "queued" || st === "in_progress" || st === "waiting" || st === "requested" || st === "pending") {
      pending = true;
    }
    if (st === "completed") {
      const c = r.conclusion;
      if (c === "failure" || c === "timed_out") failed = true;
    }
  }
  return { failed, pending };
}

export async function githubMergePullRequest(
  prNumber: number,
  mergeMethod: "merge" | "squash" | "rebase"
): Promise<{ sha: string }> {
  const { owner, repo } = repoOrThrow();
  const j = await githubJson<{ sha?: string }>("PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    merge_method: mergeMethod,
  });
  const sha = j.sha?.trim();
  if (!sha) throw new GrowthGithubIssueError("マージは成功したが merge SHA を取得できませんでした");
  return { sha };
}

type IssueComment = { body?: string | null };

export async function githubListIssueComments(issueNumber: number): Promise<string[]> {
  const { owner, repo } = repoOrThrow();
  const bodies: string[] = [];
  let page = 1;
  for (;;) {
    const arr = await githubJson<IssueComment[]>(
      "GET",
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`
    );
    for (const c of arr) {
      if (c.body) bodies.push(c.body);
    }
    if (arr.length < 100) break;
    page += 1;
    if (page > 30) break;
  }
  return bodies;
}
