import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUserMemoryPromptBlock,
  mergeMemoryFacts,
  redactSensitiveForMemory,
} from "./user_memory_prompt.js";

test("redactSensitiveForMemory masks email and long numbers", () => {
  const s = redactSensitiveForMemory("連絡は test@example.com と 09012345678");
  assert.match(s, /REDACTED_EMAIL/);
  assert.match(s, /REDACTED/);
});

test("buildUserMemoryPromptBlock returns empty without facts", () => {
  assert.equal(buildUserMemoryPromptBlock(null), "");
  assert.equal(
    buildUserMemoryPromptBlock({
      memorySubjectLineUserId: "u1",
      displayName: null,
      adminMemo: null,
      memorySummary: "",
      memoryFacts: [],
      callPreference: null,
    }),
    ""
  );
});

test("buildUserMemoryPromptBlock includes summary and facts", () => {
  const block = buildUserMemoryPromptBlock({
    memorySubjectLineUserId: "u1",
    displayName: "太郎",
    adminMemo: "敬語で",
    memorySummary: "マーケ担当。毎朝レポート重視。",
    memoryFacts: [{ fact: "スプレッドシートでタスク管理", category: "workflow", confidence: 0.9 }],
    callPreference: "名字で",
  });
  assert.match(block, /長期記憶/);
  assert.match(block, /マーケ担当/);
  assert.match(block, /スプレッドシート/);
  assert.match(block, /敬語で/);
});

test("mergeMemoryFacts dedupes by normalized text", () => {
  const merged = mergeMemoryFacts(
    [{ fact: " 営業チーム ", category: "role", confidence: 0.5 }],
    [{ fact: "営業チーム", category: "role", confidence: 0.9 }],
    10
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.confidence, 0.9);
});
