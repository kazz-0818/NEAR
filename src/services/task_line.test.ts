import assert from "node:assert/strict";
import test from "node:test";
import { isTaskManagementCommand } from "./task_line.js";

test("task edit utterances are recognized", () => {
  assert.equal(isTaskManagementCommand("1番の名前を見積書作成に変更"), true);
  assert.equal(isTaskManagementCommand("2番を企画案レビューにして"), true);
  assert.equal(isTaskManagementCommand("3番のメモを先方確認待ちに更新"), true);
});
