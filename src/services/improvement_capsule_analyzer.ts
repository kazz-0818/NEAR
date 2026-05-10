import OpenAI from "openai";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { ImprovementCandidateRow } from "./improvement_capsule_repo.js";

const capsuleItemSchema = z.object({
  problem_type: z.string(),
  problem_summary: z.string(),
  context_summary: z.string(),
  improvement_proposal: z.string(),
  suggested_requirements: z.array(z.string()).default([]),
  priority: z.enum(["low", "medium", "high"]),
  confidence: z.number(),
  source_candidate_ids: z.array(z.string()).default([]),
});

const analyzerOutputSchema = z.object({
  capsules: z.array(capsuleItemSchema),
});

export type ParsedCapsuleItem = z.infer<typeof capsuleItemSchema>;

const ANALYZER_JSON_SCHEMA = {
  name: "near_improvement_capsule_batch",
  strict: false,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      capsules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            problem_type: { type: "string" },
            problem_summary: { type: "string" },
            context_summary: { type: "string" },
            improvement_proposal: { type: "string" },
            suggested_requirements: { type: "array", items: { type: "string" } },
            priority: { type: "string", enum: ["low", "medium", "high"] },
            confidence: { type: "number" },
            source_candidate_ids: { type: "array", items: { type: "string" } },
          },
          required: [
            "problem_type",
            "problem_summary",
            "context_summary",
            "improvement_proposal",
            "suggested_requirements",
            "priority",
            "confidence",
            "source_candidate_ids",
          ],
        },
      },
    },
    required: ["capsules"],
  },
} as const;

function compactCandidatesForPrompt(rows: ImprovementCandidateRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      candidate_id: r.candidate_id,
      channel_user_id: r.channel_user_id.slice(0, 8) + "…",
      trigger_reason: r.trigger_reason,
      user_message: (r.user_message ?? "").slice(0, 800),
      near_reply: (r.near_reply ?? "").slice(0, 800),
      parsed_intent: r.parsed_intent,
      route_taken: r.route_taken,
      module_name: r.module_name,
      used_llm_fallback: r.used_llm_fallback,
      used_growth_pipeline: r.used_growth_pipeline,
      created_at: r.created_at,
    })),
    null,
    0
  );
}

const SYSTEM = `あなたはNEARの会話品質改善アナリストです。
以下のLINE会話候補ログを見て、NEARの返答品質・文脈理解・ルーティング・Growth判定に改善余地があるか分析してください。

目的:
ノイズを減らし、本当に改善価値のあるものだけ「改善カプセル」として提案してください。

判断基準:
- ユーザーの意図を取り違えていないか
- 直前文脈を拾えているか
- 既存機能を使うべきだったか
- LLM回答でよかったか
- Growth/開発要件にすべきだったか
- GrowthにすべきでないものをGrowth化していないか
- 返信が曖昧すぎないか
- 同じやりとりを繰り返していないか
- 改善すると再発防止につながるか

出力は指定 JSON スキーマに従うこと。
改善価値が低いものは capsules に含めない。
同じ問題は1つのカプセルにまとめる。
推測が弱い場合は confidence を低くする。`;

export function parseImprovementCapsuleAnalyzerOutput(raw: string): ParsedCapsuleItem[] {
  const j = JSON.parse(raw) as unknown;
  const parsed = analyzerOutputSchema.parse(j);
  return parsed.capsules;
}

export async function analyzeImprovementCandidateBatch(
  rows: ImprovementCandidateRow[]
): Promise<ParsedCapsuleItem[]> {
  if (rows.length === 0) return [];
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const user = `以下の候補ログを分析し、JSON で返してください。\n\n${compactCandidatesForPrompt(rows)}`;

  const completion = await client.chat.completions.create({
    model: env.NEAR_IMPROVEMENT_CAPSULE_MODEL ?? env.OPENAI_INTENT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: ANALYZER_JSON_SCHEMA },
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    log.warn("improvement capsule analyzer: empty completion");
    return [];
  }
  try {
    return parseImprovementCapsuleAnalyzerOutput(raw);
  } catch (e) {
    log.error({ err: e }, "improvement capsule analyzer: parse failed");
    return [];
  }
}
