#!/usr/bin/env node
/**
 * OpenAI が .env のキーで応答するか確認する（キーは表示しない）
 *   npm run llm:ping
 */
import "dotenv/config";
import OpenAI from "openai";

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("OPENAI_API_KEY がありません");
  process.exit(1);
}

const model = process.env.OPENAI_INTENT_MODEL || "gpt-4o-mini";
const client = new OpenAI({ apiKey: key });

try {
  const r = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: "1+1は? 数字だけ答えて。" }],
    max_tokens: 16,
  });
  const text = r.choices[0]?.message?.content?.trim() ?? "";
  console.log("RESULT: OK（LLM は応答しています）");
  console.log("MODEL:", model);
  console.log("SAMPLE_REPLY:", text);
} catch (e) {
  console.error("RESULT: FAIL");
  console.error("ERROR:", e?.message || e);
  process.exit(1);
}
