import assert from "node:assert/strict";
import test from "node:test";
import { matchIntentHeuristic } from "../services/intentHeuristics.js";
import type { ParsedIntent } from "../models/intent.js";
import { roughSheetsBusinessRequest } from "../services/sheetsIntentPatterns.js";
import {
  canAnswerWithLLMFallback,
  isCasualGithubIssueCreationUtterance,
  isExplicitGrowthDevelopmentRequest,
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

test("A: 天気予報調べて → 外部リアルタイム扱い・Growth明示ではない", () => {
  const t = "天気予報調べて";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), false);
  assert.equal(requiresExternalRealtimeData(t), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), false);
});

test("B: 大阪の明日の天気教えて → 外部リアルタイム", () => {
  const t = "大阪の明日の天気教えて";
  assert.equal(requiresExternalRealtimeData(t), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), false);
});

test("C: NEARで天気予報を調べられるようにして → Growth明示", () => {
  const t = "NEARで天気予報を調べられるようにして";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assert.equal(requiresExternalRealtimeData(t), false);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), true);
});

test("D: 毎朝9時に大阪の天気をLINE通知して → Growth明示（定期+通知）", () => {
  const t = "毎朝9時に大阪の天気をLINE通知して";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), true);
});

test("E: 営業LINE文作って → LLMフォールバック候補・Growthにしない", () => {
  const t = "営業LINE文作って";
  assert.equal(canAnswerWithLLMFallback(t, unknown()), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), false);
});

test("F: この文章を校閲して → LLMフォールバック候補", () => {
  const t = "この文章を校閲して";
  assert.equal(canAnswerWithLLMFallback(t, unknown()), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), false);
});

test("G: スプレッドシートのタスク一覧出して → Sheets系ヒューリスティクス", () => {
  const t = "スプレッドシートのタスク一覧出して";
  assert.equal(roughSheetsBusinessRequest(t), true);
  const h = matchIntentHeuristic(t);
  assert.equal(h?.intent, "google_sheets_query");
});

test("H: スプレッドシートから売上ランキングを出せるようにして → Growth明示", () => {
  const t = "スプレッドシートから売上ランキングを出せるようにして";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), true);
});

test("I: GitHub Issue作って → カジュアルIssue依頼としてGrowthゲートを抑止", () => {
  const t = "GitHub Issue作って";
  assert.equal(isCasualGithubIssueCreationUtterance(t), true);
  assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(t, unknown()), false);
});
