import assert from "node:assert/strict";
import test from "node:test";
import {
  isGrowthMergeToMainCommand,
  parseExplicitPullRequestNumber,
} from "./growth_pr_merge_service.js";

test("parseExplicitPullRequestNumber prefers PR #", () => {
  assert.equal(parseExplicitPullRequestNumber("PR #12 反映して"), 12);
  assert.equal(parseExplicitPullRequestNumber("pull/5 をマージして"), 5);
  assert.equal(parseExplicitPullRequestNumber("#7 反映"), 7);
  assert.equal(parseExplicitPullRequestNumber("反映して"), null);
});

test("isGrowthMergeToMainCommand", () => {
  assert.equal(isGrowthMergeToMainCommand("反映して"), true);
  assert.equal(isGrowthMergeToMainCommand("mainに反映して"), true);
  assert.equal(isGrowthMergeToMainCommand("これ反映"), true);
  assert.equal(isGrowthMergeToMainCommand("issue 作って"), false);
});
