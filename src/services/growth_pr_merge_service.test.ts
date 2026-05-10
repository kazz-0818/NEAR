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
  // NFKC 後に PR# と半角数字へ正規化される想定（LINE 側の全角入力）
  assert.equal(parseExplicitPullRequestNumber("\uFF30\uFF32\uFF03\uFF11\uFF12 \u53CD\u6620\u3057\u3066"), 12);
});

test("isGrowthMergeToMainCommand", () => {
  assert.equal(isGrowthMergeToMainCommand("反映して"), true);
  assert.equal(isGrowthMergeToMainCommand("mainに反映して"), true);
  assert.equal(isGrowthMergeToMainCommand("これ反映"), true);
  assert.equal(isGrowthMergeToMainCommand("これ反映して"), true);
  assert.equal(isGrowthMergeToMainCommand("進化反映して"), true);
  assert.equal(isGrowthMergeToMainCommand("本番に反映して"), true);
  assert.equal(isGrowthMergeToMainCommand("issue 作って"), false);
  // 全角スペース＋全角 PR 表記でも NFKC 後にマージ意図として認識
  assert.equal(isGrowthMergeToMainCommand("\uFF30\uFF32\uFF03\uFF11\uFF12\u3000\u53CD\u6620\u3057\u3066"), true);
});
