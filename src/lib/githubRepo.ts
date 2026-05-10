/** `owner/repo` 形式をパース（GitHub Growth 連携共通） */
export function parseGithubRepo(raw: string | undefined): { owner: string; repo: string } | null {
  if (!raw) return null;
  const parts = raw
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}
