import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeBulkTaskAdd, splitBulkTitlesByRules } from "./task_bulk_extractor.js";

test("splitBulkTitlesByRules: 読点区切り", () => {
  const items = splitBulkTitlesByRules("見積送付、請求確認、在庫チェックをタスクに");
  assert.equal(items.length, 3);
  assert.equal(items[0], "見積送付");
  assert.equal(items[2], "在庫チェック");
});

test("looksLikeBulkTaskAdd: 3件以上", () => {
  assert.equal(
    looksLikeBulkTaskAdd("見積送付、請求確認、在庫チェックをタスクに追加"),
    true
  );
});
