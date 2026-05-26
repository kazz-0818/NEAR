import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCompoundParts,
  looksLikeCompoundTaskAddWithReminder,
} from "./task_compound_line.js";

test("looksLikeCompoundTaskAddWithReminder", () => {
  assert.equal(
    looksLikeCompoundTaskAddWithReminder("提案書作成をタスクに入れて明日17時にリマインド"),
    true
  );
  assert.equal(looksLikeCompoundTaskAddWithReminder("タスク一覧"), false);
});

test("extractCompoundParts", () => {
  const p = extractCompoundParts("提案書作成をタスクに入れて明日17時にリマインド");
  assert.ok(p);
  assert.equal(p!.title, "提案書作成");
  assert.match(p!.whenDescription, /明日/);
});
