import assert from "node:assert/strict";
import test from "node:test";
import { isExpiredMemory } from "./conversation_session_memory.js";

test("isExpiredMemory: 期限切れ", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isExpiredMemory(past), true);
});

test("isExpiredMemory: 未来は有効", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(isExpiredMemory(future), false);
});
