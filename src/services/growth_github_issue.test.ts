import assert from "node:assert/strict";
import test from "node:test";
import { parseGrowthGithubIssueLabels, redactSecretsForGithubIssueBody } from "./growth_github_issue.js";

test("parseGrowthGithubIssueLabels trims and splits", () => {
  assert.deepEqual(parseGrowthGithubIssueLabels(" near-growth , cursor-agent "), ["near-growth", "cursor-agent"]);
  assert.deepEqual(parseGrowthGithubIssueLabels(undefined), []);
});

test("redactSecretsForGithubIssueBody masks common secret patterns", () => {
  const raw = [
    "token ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd",
    "OPENAI_API_KEY=sk-123456789012345678901234567890",
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
    "postgresql://user:pass@host/db",
  ].join("\n");
  const out = redactSecretsForGithubIssueBody(raw);
  assert.match(out, /\[REDACTED\]/);
  assert.match(out, /Bearer \[REDACTED\]/);
  assert.match(out, /\[REDACTED_DB_URL\]/);
  assert.doesNotMatch(out, /ghp_[a-zA-Z0-9]{10,}/);
});
