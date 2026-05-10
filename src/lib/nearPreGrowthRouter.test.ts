import assert from "node:assert/strict";
import test from "node:test";
import { matchIntentHeuristic } from "../services/intentHeuristics.js";
import type { ParsedIntent } from "../models/intent.js";
import { roughSheetsBusinessRequest } from "../services/sheetsIntentPatterns.js";
import { isGrowthMergeToMainCommand } from "../services/growth_pr_merge_service.js";
import { resolveUserOperation } from "./utteranceResolver.js";
import {
  isAiAnswerableHeuristic,
  isExplicitGrowthDevelopmentRequest,
  isForcedGrowthOrIssueCommand,
  requiresExternalRealtimeData,
  shouldAllowGrowthSuggestionAfterPreRouter,
} from "./nearPreGrowthRouter.js";

const unknown = (confidence = 0.4): ParsedIntent => ({
  intent: "unknown_custom_request",
  confidence,
  can_handle: false,
  required_params: {},
  needs_followup: false,
  followup_question: null,
  reason: "test",
  suggested_category: null,
});

test("外部リアルタイム: 天気予報調べて", () => {
  const t = "天気予報調べて";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), false);
  assert.equal(requiresExternalRealtimeData(t), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), false);
});

test("明示Growth: NEARで天気予報を調べられるようにして", () => {
  const t = "NEARで天気予報を調べられるようにして";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assert.equal(requiresExternalRealtimeData(t), false);
});

test("明示Growth: 毎朝9時に大阪の天気をLINE通知して", () => {
  assert.equal(isExplicitGrowthDevelopmentRequest("毎朝9時に大阪の天気をLINE通知して"), true);
});

test("AI回答: 文面考えて / この文章を直して / 要約して / どう思う？ / アイデア出して", () => {
  const samples = [
    "文面考えて",
    "この文章を直して",
    "要約して",
    "これどう思う？",
    "アイデア出して",
  ];
  for (const t of samples) {
    assert.equal(isAiAnswerableHeuristic(t, unknown()), true, t);
    assert.equal(isExplicitGrowthDevelopmentRequest(t), false, t);
  }
});

test("AI回答: 営業LINE文作って / 投稿文作って / Cursorへの指示文作って / 企画を整理して", () => {
  const samples = ["営業LINE文作って", "投稿文作って", "Cursorへの指示文作って", "企画を整理して"];
  for (const t of samples) {
    assert.equal(isAiAnswerableHeuristic(t, unknown()), true, t);
  }
});

test("Growth明示または強制コマンド", () => {
  const growthSamples = [
    "NEARで文面テンプレを保存できるようにして",
    "毎朝9時に通知して",
    "スプレッドシートに自動保存して",
    "外部APIと連携して",
    "この機能を追加して",
    "成長案にして",
    "GitHub Issue作って",
    "Cursorに投げて",
  ];
  for (const t of growthSamples) {
    const ex = isExplicitGrowthDevelopmentRequest(t);
    const fd = isForcedGrowthOrIssueCommand(t);
    assert.ok(ex || fd, `expected growth routing: ${t} (explicit=${ex} forced=${fd})`);
  }
});

test("強制コマンドは Growth ゲートで許可", () => {
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter("GitHub Issue作って", unknown()), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter("成長案にして", unknown()), true);
});

test("Sheets: スプレッドシートのタスク一覧出して", () => {
  const t = "スプレッドシートのタスク一覧出して";
  assert.equal(roughSheetsBusinessRequest(t), true);
  assert.equal(matchIntentHeuristic(t)?.intent, "google_sheets_query");
});

test("Sheets explicit: スプレッドシートから売上ランキングを出せるようにして", () => {
  assert.equal(isExplicitGrowthDevelopmentRequest("スプレッドシートから売上ランキングを出せるようにして"), true);
});

test("タスク一覧 / タスク追加 / リマインド系は utterance / thin 側でモジュールへ", () => {
  assert.equal(resolveUserOperation({ text: "タスク一覧" }).kind, "task.list.local");
  assert.equal(resolveUserOperation({ text: "タスク追加して" }).kind, "task.add");
  const r = resolveUserOperation({ text: "5分後にリマインド" });
  assert.ok(r.kind === "reminder.create" || r.kind === "general.chat" || r.kind === "unknown", r.kind);
});

test("管理者向け PR 反映コマンド（本ルーター外で処理）", () => {
  assert.equal(isGrowthMergeToMainCommand("反映して"), true);
  assert.equal(isForcedGrowthOrIssueCommand("反映して"), false);
});
