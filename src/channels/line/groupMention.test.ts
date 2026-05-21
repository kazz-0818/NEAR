import assert from "node:assert/strict";
import test from "node:test";
import { textContainsNearNameReferral } from "./groupMention.js";
import { looksLikeTrivialLinePing } from "./trivialPing.js";

test("textContainsNearNameReferral matches hiragana にあ", () => {
  assert.equal(textContainsNearNameReferral("にあ"), true);
  assert.equal(textContainsNearNameReferral("にあ　タスク一覧"), true);
  assert.equal(textContainsNearNameReferral("linear"), false);
});

test("looksLikeTrivialLinePing matches にあ alone", () => {
  assert.equal(looksLikeTrivialLinePing("にあ"), true);
  assert.equal(looksLikeTrivialLinePing("にあ　"), true);
  assert.equal(looksLikeTrivialLinePing("にあさん"), false);
});
