import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** dist/lib または src/lib から見たリポジトリルート（…/NEAR） */
const repoRoot = join(__dirname, "..", "..");

function readUtf8(relFromRepoRoot: string): string {
  const p = join(repoRoot, relFromRepoRoot);
  return fs.readFileSync(p, "utf8");
}

/** ソース上の日本語が UTF-8 として意図どおり含まれているか（文字化けした Latin-1 風の並びを検知しない） */
test("growth v4 source files contain canonical Japanese phrases (UTF-8)", () => {
  const merge = readUtf8("src/services/growth_pr_merge_service.ts");
  const sync = readUtf8("src/lib/growthLocalSyncText.ts");
  const mergeTest = readUtf8("src/services/growth_pr_merge_service.test.ts");

  for (const needle of [
    "反映して",
    "mainに反映",
    "マージして",
    "これ反映",
    "進化反映",
    "本番に反映",
    "実装依頼",
  ]) {
    assert.ok(
      merge.includes(needle),
      `growth_pr_merge_service.ts should include ${JSON.stringify(needle)}`
    );
  }

  for (const needle of ["NEARの進化が完了しました。", "ローカル同期コマンド:", "最新コミット:", "PR:", "Issue:"]) {
    assert.ok(sync.includes(needle), `growthLocalSyncText.ts should include ${JSON.stringify(needle)}`);
  }

  assert.ok(mergeTest.includes("反映して"), "test file should use same UTF-8 command strings");

  assert.ok(!merge.includes("\uFFFD"), "replacement char should not appear in merge service source");
  assert.ok(!sync.includes("\uFFFD"), "replacement char should not appear in sync text source");
});
