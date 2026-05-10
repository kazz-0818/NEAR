import assert from "node:assert/strict";
import test from "node:test";
import { parseImprovementCapsuleAnalyzerOutput } from "./improvement_capsule_analyzer.js";

test("分析JSONをパースできる", () => {
  const raw = JSON.stringify({
    capsules: [
      {
        problem_type: "context_miss",
        problem_summary: "要約",
        context_summary: "ctx",
        improvement_proposal: "提案",
        suggested_requirements: ["テスト追加"],
        priority: "high",
        confidence: 0.85,
        source_candidate_ids: ["550e8400-e29b-41d4-a716-446655440000"],
      },
    ],
  });
  const caps = parseImprovementCapsuleAnalyzerOutput(raw);
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.confidence, 0.85);
});

test("confidence が低いカプセルもパースはできる（通知は別レイヤー）", () => {
  const raw = JSON.stringify({
    capsules: [
      {
        problem_type: "other",
        problem_summary: "弱い",
        context_summary: "c",
        improvement_proposal: "p",
        suggested_requirements: [],
        priority: "low",
        confidence: 0.2,
        source_candidate_ids: [],
      },
    ],
  });
  const caps = parseImprovementCapsuleAnalyzerOutput(raw);
  assert.equal(caps[0]!.confidence < 0.7, true);
});
