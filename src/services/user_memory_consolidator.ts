import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";
import { recordLlmUsage, usageFromChatCompletion } from "../lib/llmUsage.js";
import {
  userMemoryConsolidationSchema,
  type UserMemoryFact,
  type UserMemoryRow,
} from "../models/userMemory.js";
import { mergeMemoryFacts, redactSensitiveForMemory } from "./user_memory_prompt.js";

let systemPromptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (systemPromptCache) return systemPromptCache;
  systemPromptCache = await loadPrompt("prompts/user_memory_consolidator.system.md");
  return systemPromptCache;
}

function truncate(s: string, max: number): string {
  const t = redactSensitiveForMemory(s.replace(/\s+/g, " ").trim());
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export type ConsolidateUserMemoryInput = {
  displayName: string | null;
  adminMemo: string | null;
  existing: UserMemoryRow | null;
  userText: string;
  nearReply: string;
  recentUserMessages: string[];
  recentAssistantMessages: string[];
};

export type ConsolidateUserMemoryResult = {
  memorySummary: string;
  memoryFacts: UserMemoryFact[];
  callPreference: string | null;
} | null;

export async function consolidateUserMemoryWithLlm(
  input: ConsolidateUserMemoryInput
): Promise<ConsolidateUserMemoryResult> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const system = await getSystemPrompt();

  const prevSummary = input.existing?.memory_summary?.trim() ?? "";
  const prevFacts = input.existing?.memory_facts ?? [];
  const prevCall = input.existing?.call_preference ?? null;

  const prevUser = input.recentUserMessages
    .filter((s) => s.trim())
    .slice(-6)
    .map((s, i) => `${i + 1}. ${truncate(s, 900)}`)
    .join("\n");
  const prevAsst = input.recentAssistantMessages
    .filter((s) => s.trim())
    .slice(-4)
    .map((s, i) => `${i + 1}. ${truncate(s, 1200)}`)
    .join("\n\n");

  const userContent =
    `【既存の長期記憶】\n` +
    `要約: ${prevSummary || "(なし)"}\n` +
    `呼び方: ${prevCall ?? "(未設定)"}\n` +
    `ファクト: ${JSON.stringify(prevFacts.slice(0, 20), null, 0)}\n` +
    (input.adminMemo?.trim() ? `\n【管理者メモ】\n${truncate(input.adminMemo, 600)}\n` : "") +
    (input.displayName?.trim() ? `\n【LINE表示名】\n${input.displayName.trim()}\n` : "") +
    `\n【直近のユーザー発言（抜粋）】\n${prevUser || "(なし)"}\n` +
    `\n【直近の NEAR 返答（抜粋）】\n${prevAsst || "(なし)"}\n` +
    `\n【今回のユーザー発言】\n${truncate(input.userText, 2000)}\n` +
    `\n【今回の NEAR 返答】\n${truncate(input.nearReply, 2500)}\n` +
    "\n上記を統合し、更新後の JSON を返す。";

  try {
    const completion = await client.chat.completions.create({
      model: env.NEAR_USER_MEMORY_MODEL?.trim() || env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      max_tokens: env.NEAR_USER_MEMORY_MAX_OUTPUT_TOKENS,
      temperature: 0.25,
    });
    const usage = usageFromChatCompletion(completion, {
      agentName: "near",
      source: "user_memory_consolidator",
      model: env.NEAR_USER_MEMORY_MODEL?.trim() || env.OPENAI_INTENT_MODEL,
    });
    if (usage) recordLlmUsage(usage);

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const json = JSON.parse(raw) as unknown;
    const parsed = userMemoryConsolidationSchema.safeParse(json);
    if (!parsed.success) {
      log.warn({ issues: parsed.error.flatten() }, "user memory consolidation schema mismatch");
      return null;
    }

    const mergedFacts = mergeMemoryFacts(
      prevFacts,
      parsed.data.memory_facts.map((f) => ({
        ...f,
        learned_at: f.learned_at ?? new Date().toISOString(),
      })),
      env.NEAR_USER_MEMORY_MAX_FACTS
    );

    return {
      memorySummary: redactSensitiveForMemory(parsed.data.memory_summary.trim()).slice(0, 4000),
      memoryFacts: mergedFacts,
      callPreference: parsed.data.call_preference?.trim() || prevCall,
    };
  } catch (e) {
    log.warn({ err: e }, "consolidateUserMemoryWithLlm failed");
    return null;
  }
}
