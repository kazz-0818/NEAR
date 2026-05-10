import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedIntent } from "../models/intent.js";
import {
  collectLocalRuleHits,
  matchesUserCorrectionSignal,
  matchesDeicticOrContextReference,
  roughSimilarUserUtterances,
} from "./improvement_capsule_rules.js";

const parsed = (intent: ParsedIntent["intent"]): ParsedIntent => ({
  intent,
  confidence: 0.9,
  can_handle: true,
  required_params: {},
  needs_followup: false,
  followup_question: null,
  reason: "t",
  suggested_category: null,
});

test("ユーザー否定・修正の語でヒット", () => {
  assert.equal(matchesUserCorrectionSignal("違う、そういうことじゃない"), true);
  assert.equal(matchesUserCorrectionSignal("文脈見て"), true);
  assert.equal(matchesUserCorrectionSignal("それ開発要件じゃない"), true);
});

test("直前文脈参照っぽい短文でヒット", () => {
  assert.equal(matchesDeicticOrContextReference("前の1番の話"), true);
  assert.equal(matchesDeicticOrContextReference("それ"), true);
});

test("通常のタスク依頼では否定シグナルにしない", () => {
  assert.equal(matchesUserCorrectionSignal("明日までに資料をまとめるタスクを追加して"), false);
});

test("短時間言い直し用の類似判定", () => {
  assert.equal(roughSimilarUserUtterances("会議の議事をまとめて", "会議の議事をまとめてください"), true);
  assert.equal(roughSimilarUserUtterances("全然違う話", "会議の議事をまとめて"), false);
});

test("ルーティング: 構造化 intent で LLM フォールバックならヒット", () => {
  const snap = {
    userText: "x",
    parsed: parsed("task_create"),
    routeTaken: "llm_fallback",
    moduleName: null,
    usedLlmFallback: true,
    usedGrowthPipeline: false,
    preGrowthCategory: null as string | null,
  };
  const hits = collectLocalRuleHits("資料を追記して", snap);
  assert.ok(hits.some((h) => h.triggerReason.startsWith("routing:")));
});

test("LLM fallback で自然な相談のみならルーティング疑いは出にくい", () => {
  const snap = {
    userText: "x",
    parsed: parsed("simple_question"),
    routeTaken: "llm_fallback",
    moduleName: null,
    usedLlmFallback: true,
    usedGrowthPipeline: false,
    preGrowthCategory: null as string | null,
  };
  const hits = collectLocalRuleHits("営業メールの件名を3案出して", snap);
  assert.equal(hits.some((h) => h.triggerReason.startsWith("routing:")), false);
});
