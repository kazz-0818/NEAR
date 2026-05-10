import { getEnv } from "../config/env.js";
import { parseGithubRepo } from "../lib/githubRepo.js";

export class GrowthGithubIssueError extends Error {
  readonly code = "GrowthGithubIssueError";
  constructor(message: string) {
    super(message);
    this.name = "GrowthGithubIssueError";
  }
}

export type CreateGrowthIssueInput = {
  suggestionId: number | string;
  title: string;
  body: string;
  labels?: string[];
};

export type CreateGrowthIssueResult = {
  issueNumber: number;
  issueUrl: string;
};

/**
 * GitHub REST API で Issue を作成する（GITHUB_TOKEN / GROWTH_GITHUB_REPO は環境変数）。
 * トークンやレスポンス全文はログに出さないこと。
 */
export async function createGrowthIssue(input: CreateGrowthIssueInput): Promise<CreateGrowthIssueResult> {
  const env = getEnv();
  const token = env.GITHUB_TOKEN;
  const gh = parseGithubRepo(env.GROWTH_GITHUB_REPO);
  if (!token) {
    throw new GrowthGithubIssueError("GITHUB_TOKEN が未設定です");
  }
  if (!gh) {
    throw new GrowthGithubIssueError("GROWTH_GITHUB_REPO が owner/repo 形式ではありません");
  }

  const url = `https://api.github.com/repos/${gh.owner}/${gh.repo}/issues`;
  const tryPost = async (labels: string[] | undefined): Promise<Response> => {
    const payload: Record<string, unknown> = {
      title: input.title,
      body: input.body,
    };
    if (labels?.length) payload.labels = labels;
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  };

  let res = await tryPost(input.labels);
  const text = await res.text();

  if (!res.ok && res.status === 422 && input.labels?.length) {
    res = await tryPost(undefined);
    const text2 = await res.text();
    if (!res.ok) {
      throw ghIssueHttpError(res.status, text2);
    }
    return parseIssueCreateResponse(text2);
  }

  if (!res.ok) {
    throw ghIssueHttpError(res.status, text);
  }

  return parseIssueCreateResponse(text);
}

function ghIssueHttpError(status: number, body: string): GrowthGithubIssueError {
  let detail = `HTTP ${status}`;
  try {
    const j = JSON.parse(body) as { message?: string };
    if (typeof j.message === "string" && j.message.length > 0) {
      detail += `: ${j.message.slice(0, 400)}`;
    }
  } catch {
    /* ignore */
  }
  return new GrowthGithubIssueError(detail);
}

function parseIssueCreateResponse(text: string): CreateGrowthIssueResult {
  let issueNumber = 0;
  let issueUrl = "";
  try {
    const j = JSON.parse(text) as { number?: number; html_url?: string };
    if (typeof j.number === "number") issueNumber = j.number;
    if (typeof j.html_url === "string") issueUrl = j.html_url;
  } catch {
    throw new GrowthGithubIssueError("GitHub API の応答を解釈できませんでした");
  }
  if (!issueNumber || !issueUrl) {
    throw new GrowthGithubIssueError("GitHub API から Issue 番号または URL を取得できませんでした");
  }
  return { issueNumber, issueUrl };
}
