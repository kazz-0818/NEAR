import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTaskItemsFromAssistantMessages,
  parseReminderWhenDescription,
  parseTaskTargetNumber,
} from "./taskListContext.js";

test("extract task items from assistant task list", () => {
  const items = extractTaskItemsFromAssistantMessages([
    "別メッセージ",
    "📋 タスク一覧（2件）:\n1. 【個人】 システム開発\n2. 【グループ】 請求書確認\n\n完了: 「タスク完了 1」  削除: 「タスク削除 1」",
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { number: 1, title: "システム開発", scope: "個人" });
  assert.deepEqual(items[1], { number: 2, title: "請求書確認", scope: "グループ" });
});

test("parse task target number variants", () => {
  assert.equal(parseTaskTargetNumber("1ばん"), 1);
  assert.equal(parseTaskTargetNumber("１番"), 1);
  assert.equal(parseTaskTargetNumber("一番"), 1);
  assert.equal(parseTaskTargetNumber("いちばん"), 1);
  assert.equal(parseTaskTargetNumber("最初"), 1);
  assert.equal(parseTaskTargetNumber("上のやつ"), 1);
});

test("parse reminder when description", () => {
  assert.equal(parseReminderWhenDescription("一番5分後にリマインドして"), "5分後");
  assert.equal(parseReminderWhenDescription("最初のやつ明日10時に教えて"), "明日10時");
});
