import assert from "node:assert/strict";
import test from "node:test";
import { parseReminderAtFromDescription } from "./datetimeContext.js";

test("parseReminderAtFromDescription: 明日17時", () => {
  const from = new Date("2026-05-21T10:00:00+09:00");
  const d = parseReminderAtFromDescription("明日17時", from);
  assert.ok(d);
  const jst = d!.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit" });
  assert.match(jst, /17/);
});

test("parseReminderAtFromDescription: 30分後", () => {
  const from = new Date("2026-05-21T10:00:00+09:00");
  const d = parseReminderAtFromDescription("30分後", from);
  assert.ok(d);
  assert.equal(d!.getTime(), from.getTime() + 30 * 60_000);
});
