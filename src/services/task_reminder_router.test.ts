import assert from "node:assert/strict";
import test from "node:test";
import { tryResolveReminderFromRecentTaskList } from "./task_reminder_router.js";

test("resolve reminder from latest task list by number", async () => {
  const r = await tryResolveReminderFromRecentTaskList({
    db: {} as never,
    channelUserId: "U1",
    actorUserId: "U1",
    text: "一番5分後にリマインドして",
    recentAssistantMessages: ["📋 タスク一覧（1件）:\n1. 【個人】 システム開発"],
  });
  assert.equal(r.matched, true);
  if (r.matched && r.mode === "resolved") {
    assert.equal(r.title, "システム開発");
    assert.equal(r.whenDescription, "5分後");
    assert.equal(r.targetNumber, 1);
  }
});

test("single task list item can be auto-selected", async () => {
  const r = await tryResolveReminderFromRecentTaskList({
    db: {} as never,
    channelUserId: "U1",
    actorUserId: "U1",
    text: "5分後にリマインドして",
    recentAssistantMessages: ["1. 【個人】 システム開発"],
  });
  assert.equal(r.matched, true);
  if (r.matched && r.mode === "resolved") {
    assert.equal(r.title, "システム開発");
    assert.equal(r.whenDescription, "5分後");
    assert.equal(r.targetNumber, 1);
  }
});
