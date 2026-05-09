import assert from "node:assert/strict";
import test from "node:test";
import { resolveSemanticOperation } from "./semantic_operation_resolver.js";

test("semantic resolver parses mocked json response", async () => {
  const op = await resolveSemanticOperation(
    {
      db: {} as never,
      userText: "たすくいれといて",
      recentUserMessages: [],
      recentAssistantMessages: [],
    },
    {
      callModel: async () =>
        JSON.stringify({
          kind: "task.add",
          confidence: 0.92,
          extracted_text: "たすく",
          target_number: null,
          target_label: null,
          needs_confirmation: false,
          danger_level: "low",
          reason: "fuzzy_add_task",
          route_hint: "task_line",
        }),
    }
  );
  assert.equal(op.kind, "task.add");
  assert.equal(op.confidence, 0.92);
  assert.equal(op.route_hint, "task_line");
});

test("semantic resolver falls back on invalid json", async () => {
  const op = await resolveSemanticOperation(
    {
      db: {} as never,
      userText: "あれやっといて",
      recentUserMessages: [],
      recentAssistantMessages: [],
    },
    {
      callModel: async () => "not-json",
    }
  );
  assert.equal(op.kind, "unknown");
  assert.equal(op.confidence, 0);
});

test("semantic resolver keeps delete confirmation metadata", async () => {
  const op = await resolveSemanticOperation(
    {
      db: {} as never,
      userText: "2も消して",
      recentUserMessages: ["タスク一覧見せて"],
      recentAssistantMessages: ["📋 タスク一覧（3件）\n1. A\n2. B\n3. C"],
    },
    {
      callModel: async () =>
        JSON.stringify({
          kind: "task.delete",
          confidence: 0.91,
          extracted_text: null,
          target_number: 2,
          target_label: null,
          needs_confirmation: true,
          danger_level: "high",
          reason: "ambiguous_delete_contextual",
          route_hint: "task_line",
        }),
    }
  );
  assert.equal(op.kind, "task.delete");
  assert.equal(op.target_number, 2);
  assert.equal(op.needs_confirmation, true);
});
