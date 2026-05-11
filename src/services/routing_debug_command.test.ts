import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRoutingDebugReportForLine,
  isRoutingDebugQuery,
  matchOneClickImprovementQuery,
} from "./routing_debug_command.js";
import type { RoutingTraceRow } from "./routing_trace_service.js";
import { parseReminderWhenDescription } from "../lib/taskListContext.js";

test("isRoutingDebugQuery: なぜそう判断した？", () => {
  assert.equal(isRoutingDebugQuery("なぜそう判断した？"), true);
  assert.equal(isRoutingDebugQuery("直前の判定見せて"), true);
  assert.equal(isRoutingDebugQuery("ルーティング確認"), true);
  assert.equal(isRoutingDebugQuery("なぜDriveに行った？"), true);
});

test("isRoutingDebugQuery: 通常の依頼では false", () => {
  assert.equal(isRoutingDebugQuery("リマインド一覧だして"), false);
  assert.equal(isRoutingDebugQuery("タスクリスト出して"), false);
});

test("matchOneClickImprovementQuery", () => {
  assert.equal(matchOneClickImprovementQuery("今の返答おかしい"), "manual_bad_reply");
  assert.equal(matchOneClickImprovementQuery("カプセル化して"), "manual_capsule");
  assert.equal(matchOneClickImprovementQuery("ルーティングミスとして保存して"), "manual_wrong_route");
  assert.equal(matchOneClickImprovementQuery("EC出品をタスクに追加"), null);
});

test("parseReminderWhenDescription: 明日の13時（のあり）", () => {
  assert.equal(parseReminderWhenDescription("これ明日の13時に通知して"), "明日の13時");
});

test("formatRoutingDebugReportForLine: 要約に秘密を含めない短い整形", () => {
  const row = {
    trace_id: "x",
    channel_user_id: "u",
    inbound_message_id: "1",
    user_message: "リマインド一覧だして",
    route: "internal_reminder_list",
    module_name: null,
    intent: null,
    confidence: null,
    reason: "explicit reminder list",
    used_llm_fallback: false,
    used_growth_pipeline: false,
    used_improvement_capsule_candidate: false,
    used_pending: true,
    cleared_pending: true,
    pending_type: "sheet_pick",
    pending_id: null,
    sheet_used: false,
    drive_used: false,
    reminder_used: true,
    task_used: false,
    github_used: false,
    final_reply_summary: "現在のリマインド一覧です。",
    meta_json: {},
    created_at: new Date(),
  } as RoutingTraceRow;
  const out = formatRoutingDebugReportForLine(row);
  assert.match(out, /internal_reminder_list/);
  assert.match(out, /リマインド一覧/);
  assert.match(out, /解除あり/);
});
