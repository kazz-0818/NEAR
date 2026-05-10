import assert from "node:assert/strict";
import test from "node:test";
import { matchIntentHeuristic } from "../services/intentHeuristics.js";
import type { ParsedIntent } from "../models/intent.js";
import { roughSheetsBusinessRequest } from "../services/sheetsIntentPatterns.js";
import { isGrowthMergeToMainCommand } from "../services/growth_pr_merge_service.js";
import { resolveUserOperation } from "./utteranceResolver.js";
import {
  classifyPreGrowthRequest,
  impliesLiveDataOrExternalOneShot,
  isExplicitGrowthDevelopmentRequest,
  shouldAllowGrowthSuggestionAfterPreRouter,
} from "./nearPreGrowthRouter.js";

const unknown = (intent: ParsedIntent["intent"] = "unknown_custom_request", confidence = 0.4): ParsedIntent => ({
  intent,
  confidence,
  can_handle: intent !== "unknown_custom_request",
  required_params: {},
  needs_followup: false,
  followup_question: null,
  reason: "test",
  suggested_category: null,
});

function assertPreGrowth(
  label: string,
  text: string,
  want: { growth?: boolean; external?: boolean; llm?: boolean; allowGrowth?: boolean }
): void {
  const c = classifyPreGrowthRequest(text, unknown());
  if (want.growth !== undefined) {
    assert.equal(c.category === "growth_explicit" && c.allowGrowth, want.growth, `${label} growth`);
  }
  if (want.external !== undefined) {
    assert.equal(c.category === "external_realtime_answer", want.external, `${label} external`);
  }
  if (want.llm !== undefined) {
    assert.equal(c.preferLlmFallback && c.category !== "growth_explicit", want.llm, `${label} llm prefer`);
  }
  if (want.allowGrowth !== undefined) {
    assert.equal(shouldAllowGrowthSuggestionAfterPreRouter(text, unknown()), want.allowGrowth, `${label} gate`);
  }
}

test("1 天気予報調べて: Growthにしない・外部ワンショット扱い", () => {
  assertPreGrowth("1", "天気予報調べて", { growth: false, external: true, llm: false });
  assert.equal(impliesLiveDataOrExternalOneShot("天気予報調べて"), true);
});

test("2 NEARで天気予報を調べられるようにして: Growth", () => {
  assertPreGrowth("2", "NEARで天気予報を調べられるようにして", { growth: true, external: false, llm: false });
});

test("3 毎朝9時に大阪の天気をLINE通知して: Growth", () => {
  assertPreGrowth("3", "毎朝9時に大阪の天気をLINE通知して", { growth: true });
});

test("4 営業LINE文作って: Growthにしない・LLM優先", () => {
  assertPreGrowth("4", "営業LINE文作って", { growth: false, external: false, llm: true, allowGrowth: false });
});

test("5 この文章を校閲して: Growthにしない・LLM優先", () => {
  assertPreGrowth("5", "この文章を校閲して", { growth: false, llm: true, allowGrowth: false });
});

test("6 この内容をスプレッドシートに保存できるようにして: Growth", () => {
  const t = "この内容をスプレッドシートに保存できるようにして";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assertPreGrowth("6", t, { growth: true, allowGrowth: true });
});

test("7 スプレッドシートのタスク一覧出して: Sheets・Growthにしない", () => {
  const t = "スプレッドシートのタスク一覧出して";
  assert.equal(roughSheetsBusinessRequest(t), true);
  assert.equal(matchIntentHeuristic(t)?.intent, "google_sheets_query");
  assertPreGrowth("7", t, { growth: false, llm: true, allowGrowth: false });
});

test("8 売上ランキングを自動で毎朝LINE通知して: Growth", () => {
  const t = "売上ランキングを自動で毎朝LINE通知して";
  assertPreGrowth("8", t, { growth: true });
});

test("9 おすすめの副業教えて: Growthにしない・LLM優先", () => {
  assertPreGrowth("9", "おすすめの副業教えて", { growth: false, external: false, llm: true, allowGrowth: false });
});

test("10 GitHub Issue作って: Growthにしない（LLM／既存Issue経路想定）", () => {
  assertPreGrowth("10", "GitHub Issue作って", { growth: false, llm: true, allowGrowth: false });
});

test("11 GitHub Issueを自動作成できるようにして: Growth", () => {
  const t = "GitHub Issueを自動作成できるようにして";
  assertPreGrowth("11", t, { growth: true });
});

test("12 Instagram投稿文作って: Growthにしない・LLM優先", () => {
  assertPreGrowth("12", "Instagram投稿文作って", { growth: false, llm: true, allowGrowth: false });
});

test("13 Instagramに自動投稿できるようにして: Growth", () => {
  const t = "Instagramに自動投稿できるようにして";
  assertPreGrowth("13", t, { growth: true });
});

test("タスク一覧 / タスク追加は utterance 解決", () => {
  assert.equal(resolveUserOperation({ text: "タスク一覧" }).kind, "task.list.local");
  assert.equal(resolveUserOperation({ text: "タスク追加して" }).kind, "task.add");
});

test("管理者向け PR 反映は別系統（merge コマンド）", () => {
  assert.equal(isGrowthMergeToMainCommand("反映して"), true);
  assert.equal(classifyPreGrowthRequest("反映して", unknown()).category !== "growth_explicit", true);
});

test("大阪の天気教えて: 外部ワンショット（Growth にしない）", () => {
  assertPreGrowth("大阪天気", "大阪の天気教えて", { growth: false, external: true, llm: false, allowGrowth: false });
});

test("この文章を柔らかくして: LLM（Growth にしない）", () => {
  assertPreGrowth("柔らかく", "この文章を柔らかくして", { growth: false, external: false, llm: true, allowGrowth: false });
});

test("タスク一覧出して: 既存タスク一覧（pre-growth は LLM 既定だが実ルートは task）", () => {
  assert.equal(resolveUserOperation({ text: "タスク一覧出して" }).kind, "task.list.local");
  assertPreGrowth("タスク一覧出", "タスク一覧出して", { growth: false, llm: true, allowGrowth: false });
});

test("スプレッドシートの売上ランキングを毎朝LINE通知して: Growth", () => {
  const t = "スプレッドシートの売上ランキングを毎朝LINE通知して";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assertPreGrowth("売上毎朝LINE", t, { growth: true });
});

test("NEARに〇〇機能を追加して: Growth", () => {
  const t = "NEARに〇〇機能を追加して";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assertPreGrowth("NEAR機能追加", t, { growth: true });
});

test("NEARに新しい機能を追加して: Growth（別表記）", () => {
  const t = "NEARに新しい機能を追加して";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assertPreGrowth("NEAR新機能", t, { growth: true });
});

test("管理できるようにして: Growth（継続機能の明示）", () => {
  const t = "顧客リストをNEARで管理できるようにして";
  assert.equal(isExplicitGrowthDevelopmentRequest(t), true);
  assertPreGrowth("管理できる", t, { growth: true });
});
