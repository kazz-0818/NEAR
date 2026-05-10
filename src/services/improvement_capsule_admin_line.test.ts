import assert from "node:assert/strict";
import test from "node:test";
import { parseImprovementCapsuleAdminNumericId } from "./improvement_capsule_admin_line.js";

test("カプセル番号のパース", () => {
  assert.equal(parseImprovementCapsuleAdminNumericId("カプセル 123 詳細"), 123);
  assert.equal(parseImprovementCapsuleAdminNumericId("改善カプセル456見せて"), 456);
  assert.equal(parseImprovementCapsuleAdminNumericId("カプセル789をIssue化して"), 789);
});
