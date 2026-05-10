import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import { parseGithubRepo } from "../lib/githubRepo.js";
import { GrowthGithubIssueError } from "./githubIssueService.js";
import {
  githubGetBranchHeadSha,
  githubGetDefaultBranch,
  githubGetPullRequest,
  githubCheckRunSummary,
  githubListIssueComments,
  githubListOpenPullsByHead,
  githubMergePullRequest,
  type GithubPullView,
} from "./growth_github_rest.js";
import { notifyNearEvolutionComplete } from "./admin_notification_service.js";

export function isGrowthMergeToMainCommand(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  if (
    /issue\s*作って|issue作って|issue\s*作成|issue作成/i.test(t) ||
    (/実装依頼|github\s*issue/i.test(t) && /(作って|作成|依頼)/i.test(t))
  ) {
    return false;
  }
  return /(反映して|mainに反映|マージして|このPR反映|これ反映)/i.test(t);
}

/** PR 番号を明示していれば返す（suggestion # との混同を避けるため PR # を優先） */
export function parseExplicitPullRequestNumber(text: string): number | null {
  const t = text.normalize("NFKC");
  const m1 = t.match(/PR\s*#\s*(\d{1,6})\b/i);
  if (m1?.[1]) return Number(m1[1]);
  const m2 = t.match(/\bpull\/(\d{1,6})\b/i);
  if (m2?.[1]) return Number(m2[1]);
  const m3 = t.match(/#(\d{1,6})\s*(?:を)?\s*(?:反映|マージ)/);
  if (m3?.[1]) return Number(m3[1]);
  return null;
}

function shortSha(sha: string): string {
  return sha.replace(/^sha=/i, "").trim().slice(0, 7);
}

function prUrl(owner: string, repo: string, num: number): string {
  return `https://github.com/${owner}/${repo}/pull/${num}`;
}

function extractPrNumberFromTextBodies(bodies: string[], owner: string, repo: string): number | null {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let last: number | null = null;
  for (const body of bodies) {
    const re = new RegExp(`https://github\\.com/${esc(owner)}/${esc(repo)}/pull/(\\d+)`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) != null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) last = n;
    }
  }
  return last;
}

function extractIssueUrlFromBodies(bodies: string[], owner: string, repo: string): string | null {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const body of bodies) {
    const re = new RegExp(`https://github\\.com/${esc(owner)}/${esc(repo)}/issues/(\\d+)`, "i");
    const m = body.match(re);
    if (m?.[0]) return m[0].replace(/[\s)>]+$/, "");
  }
  return null;
}

function extractIssueUrlFromPrBody(body: string, owner: string, repo: string): string | null {
  return extractIssueUrlFromBodies([body], owner, repo);
}

function headAllowed(headRef: string): boolean {
  const prefs = getEnv().GROWTH_MERGE_ALLOWED_HEAD_PREFIXES;
  return prefs.some((p) => headRef.startsWith(p));
}

async function refreshMergeable(prNumber: number): Promise<GithubPullView> {
  let pr = await githubGetPullRequest(prNumber);
  for (let i = 0; i < 3 && pr.mergeable == null; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    pr = await githubGetPullRequest(prNumber);
  }
  return pr;
}

async function findOpenPrForSuggestionHeads(owner: string, repo: string, suggestionId: number, issueNum: number | null) {
  const heads = [`${owner}:near-growth/suggestion-${suggestionId}`];
  if (issueNum != null) heads.push(`${owner}:near-growth/issue-${issueNum}`);
  for (const h of heads) {
    const list = await githubListOpenPullsByHead(h);
    if (list.length > 0) return list[0]!;
  }
  return null;
}

async function persistGrowthPrMeta(db: Db, suggestionId: number, prNumber: number, prUrlStr: string): Promise<void> {
  await db.query(
    `UPDATE implementation_suggestions
     SET github_growth_pr_number = $1,
         github_growth_pr_url = $2,
         updated_at = now()
     WHERE id = $3`,
    [prNumber, prUrlStr, suggestionId]
  );
}

export type MergeGrowthPrReply = { ok: true; reply: string } | { ok: false; reply: string };

/**
 * 管理者 LINE「反映して」系: 対象 PR を解決し、安全なら main へマージ後に完了通知。
 * マージ意図が無いときは null。
 */
export async function tryMergeGrowthPrFromAdminLine(input: {
  db: Db;
  adminUserId: string;
  text: string;
}): Promise<MergeGrowthPrReply | null> {
  const norm = input.text.normalize("NFKC").trim();
  if (!isGrowthMergeToMainCommand(norm)) return null;

  const env = getEnv();
  if (!env.GROWTH_LINE_MERGE_ENABLED) {
    return { ok: false, reply: "LINE からの main マージは現在オフです（GROWTH_LINE_MERGE_ENABLED）。" };
  }
  if (!env.GITHUB_TOKEN?.trim() || !parseGithubRepo(env.GROWTH_GITHUB_REPO)) {
    return { ok: false, reply: "GITHUB_TOKEN と GROWTH_GITHUB_REPO が必要です。" };
  }
  const gh = parseGithubRepo(env.GROWTH_GITHUB_REPO)!;
  const { owner, repo } = gh;

  const explicitPr = parseExplicitPullRequestNumber(norm);
  let suggestionId: number | null = null;
  let prNumber: number | null = explicitPr;

  if (prNumber == null) {
    const sess = await input.db.query<{ active_suggestion_id: string | null }>(
      `SELECT active_suggestion_id::text AS active_suggestion_id FROM growth_admin_sessions WHERE admin_line_user_id = $1`,
      [input.adminUserId]
    );
    const raw = sess.rows[0]?.active_suggestion_id;
    suggestionId = raw != null && raw !== "" ? Number(raw) : null;
    if (suggestionId == null || !Number.isFinite(suggestionId)) {
      return {
        ok: false,
        reply: "どのPRを反映しますか？\nPR番号またはURLを送ってください。\n例: PR #3 反映して",
      };
    }

    const row = await input.db.query<{
      github_growth_pr_number: number | null;
      github_growth_pr_url: string | null;
      github_issue_number: number | null;
    }>(
      `SELECT github_growth_pr_number, github_growth_pr_url, github_issue_number
       FROM implementation_suggestions WHERE id = $1`,
      [suggestionId]
    );
    const r0 = row.rows[0];
    if (r0?.github_growth_pr_number != null && Number.isFinite(Number(r0.github_growth_pr_number))) {
      prNumber = Number(r0.github_growth_pr_number);
    } else if (r0?.github_issue_number != null) {
      try {
        const bodies = await githubListIssueComments(Number(r0.github_issue_number));
        const fromComments = extractPrNumberFromTextBodies(bodies, owner, repo);
        if (fromComments != null) prNumber = fromComments;
      } catch {
        /* fall through */
      }
    }
    if (prNumber == null) {
      try {
        const pr = await findOpenPrForSuggestionHeads(
          owner,
          repo,
          suggestionId,
          r0?.github_issue_number != null ? Number(r0.github_issue_number) : null
        );
        if (pr) prNumber = pr.number;
      } catch {
        /* ignore */
      }
    }
    if (prNumber == null) {
      return {
        ok: false,
        reply:
          "対象の PR を特定できませんでした。\n「PR #番号 反映して」で指定するか、Issue に PR URL がコメントされているか確認してください。",
      };
    }
  } else {
    const m = await input.db.query<{ id: string }>(
      `SELECT id::text AS id FROM implementation_suggestions
       WHERE github_growth_pr_number = $1
       LIMIT 1`,
      [prNumber]
    );
    if (m.rows[0]?.id) suggestionId = Number(m.rows[0].id);
  }

  const unsafeReply = (reasons: string[]) =>
    [
      "このPRは自動反映できません。",
      "",
      "理由:",
      ...reasons.map((x) => `- ${x}`),
      "",
      "GitHub上で確認してください。",
    ].join("\n");

  try {
    let pr = await refreshMergeable(prNumber);
    if (pr.state !== "open") {
      return { ok: false, reply: unsafeReply([`PR が open ではありません（state=${pr.state}）`]) };
    }

    const targetBase = getEnv().GROWTH_MERGE_TARGET_BRANCH;
    if (pr.base.ref !== targetBase) {
      return { ok: false, reply: unsafeReply([`base branch が ${targetBase} ではありません（${pr.base.ref}）`]) };
    }

    if (!headAllowed(pr.head.ref)) {
      return {
        ok: false,
        reply: unsafeReply([`head が許可された接頭辞ではありません（${pr.head.ref}）`]),
      };
    }

    if (pr.mergeable === false) {
      return { ok: false, reply: unsafeReply(["コンフリクトがある、またはマージ不能です"]) };
    }
    if (pr.mergeable_state === "dirty") {
      return { ok: false, reply: unsafeReply(["コンフリクトがあります"]) };
    }
    if (pr.mergeable_state === "blocked") {
      return { ok: false, reply: unsafeReply(["ブランチ保護などでブロックされています"]) };
    }
    if (pr.mergeable == null && pr.mergeable_state === "unknown") {
      return {
        ok: false,
        reply: unsafeReply(["マージ可否を GitHub がまだ計算できていません。しばらくしてから再度お試しください"]),
      };
    }

    const checks = await githubCheckRunSummary(pr.head.sha);
    if (checks.pending) {
      return { ok: false, reply: unsafeReply(["GitHub Actions（チェック）が実行中です。完了してから再度お試しください"]) };
    }
    if (checks.failed) {
      return { ok: false, reply: unsafeReply(["GitHub Actions（チェック）が失敗しています"]) };
    }

    const rawMethod = getEnv().GROWTH_MERGE_METHOD;
    const method =
      rawMethod === "merge" || rawMethod === "rebase" ? rawMethod : ("squash" as const);
    const { sha: mergeSha } = await githubMergePullRequest(prNumber, method);

    let issueUrl: string | null = null;
    if (pr.body) issueUrl = extractIssueUrlFromPrBody(pr.body, owner, repo);
    if (!issueUrl && suggestionId != null) {
      const ir = await input.db.query<{ github_issue_url: string | null }>(
        `SELECT github_issue_url FROM implementation_suggestions WHERE id = $1`,
        [suggestionId]
      );
      issueUrl = ir.rows[0]?.github_issue_url?.trim() ?? null;
    }

    const defaultBranch = await githubGetDefaultBranch();
    let tipSha = mergeSha;
    try {
      tipSha = await githubGetBranchHeadSha(defaultBranch);
    } catch {
      /* merge API の sha をフォールバック */
    }

    if (suggestionId != null) {
      await persistGrowthPrMeta(input.db, suggestionId, prNumber, prUrl(owner, repo, prNumber));
    }

    const prUrlStr = pr.html_url || prUrl(owner, repo, prNumber);

    await notifyNearEvolutionComplete({
      prUrl: prUrlStr,
      issueUrl,
      commitShaShort: shortSha(tipSha),
    });

    return {
      ok: true,
      reply: [
        "main へマージしました。",
        "",
        "PR:",
        prUrlStr,
        "",
        "管理者向けに完了通知（LINE）も送りました。",
      ].join("\n"),
    };
  } catch (e) {
    const msg = e instanceof GrowthGithubIssueError ? e.message : e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reply: ["マージに失敗しました。", "", msg].join("\n"),
    };
  }
}
