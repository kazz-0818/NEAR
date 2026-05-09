import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUserUtterance } from "./utteranceNormalizer.js";
import { resolveUserOperation } from "./utteranceResolver.js";

test("normalizeUserUtterance keeps lines and compacts text", () => {
  const n = normalizeUserUtterance(" システム開発\nタスク  リスト に 入れて ");
  assert.equal(n.lines[0], "システム開発");
  assert.match(n.compact, /タスクリスト/);
});

test("task.add cases", () => {
  const cases = [
    "システム開発\nタスク追加して",
    "システム開発\nタスクリストに入れて",
    "請求書確認をタスクにして",
    "これTODO入れといて",
    "明日、田中さんに連絡するのをやることに追加",
    "後でやるやつにして",
  ];
  for (const c of cases) {
    const r = resolveUserOperation({ text: c });
    assert.equal(r.kind, "task.add", c);
  }
  const extracted = resolveUserOperation({ text: "システム開発\nタスク追加して" });
  assert.equal(extracted.extractedText, "システム開発");
});

test("task.list.local cases", () => {
  const cases = [
    "タスク一覧",
    "タスクリスト",
    "今のタスク",
    "登録したタスク見せて",
    "TODO一覧",
    "今日やること",
    "何やるんだっけ",
  ];
  for (const c of cases) {
    const r = resolveUserOperation({ text: c });
    assert.equal(r.kind, "task.list.local", c);
  }
});

test("task.list.sheet cases", () => {
  const cases = [
    "スプレッドシートのタスク一覧",
    "スプシのタスク一覧",
    "スプレットのタスク一覧",
    "シートのタスク一覧",
    "ガントチャート見せて",
    "タスク管理表見せて",
  ];
  for (const c of cases) {
    const r = resolveUserOperation({ text: c });
    assert.equal(r.kind, "task.list.sheet", c);
  }
});

test("task.delete cases and confirmations", () => {
  const specific = resolveUserOperation({ text: "2消して" });
  assert.equal(specific.kind, "task.delete");
  assert.equal(specific.targetNumber, 2);
  assert.equal(specific.requiresConfirmation, false);

  const specific2 = resolveUserOperation({ text: "2番消して" });
  assert.equal(specific2.kind, "task.delete");
  assert.equal(specific2.targetNumber, 2);

  const ambiguous1 = resolveUserOperation({ text: "2も消して" });
  assert.equal(ambiguous1.kind, "task.delete");
  assert.equal(ambiguous1.requiresConfirmation, true);

  const ambiguous2 = resolveUserOperation({ text: "このタスク消して" });
  assert.equal(ambiguous2.requiresConfirmation, true);

  const ambiguous3 = resolveUserOperation({ text: "全部消して" });
  assert.equal(ambiguous3.requiresConfirmation, true);
});

test("task.update cases", () => {
  const c1 = resolveUserOperation({ text: "2完了にして" });
  assert.equal(c1.kind, "task.update");
  assert.equal(c1.targetNumber, 2);

  const c2 = resolveUserOperation({ text: "このタスク終わった" });
  assert.equal(c2.kind, "task.update");
  assert.equal(c2.requiresConfirmation, true);

  const c3 = resolveUserOperation({ text: "優先度高にして" });
  assert.equal(c3.kind, "task.update");

  const c4 = resolveUserOperation({ text: "期限を明日にして" });
  assert.equal(c4.kind, "task.update");
});

test("ambiguous cases", () => {
  const cases = ["タスク", "リスト", "あれやっといて", "さっきのやつお願い", "整理して"];
  for (const c of cases) {
    const r = resolveUserOperation({ text: c });
    assert.equal(r.kind, "task.clarify", c);
  }
});
