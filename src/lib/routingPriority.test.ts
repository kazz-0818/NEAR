/**
 * ルーティング優先順位テスト
 *
 * 実機で発生した誤ルーティングのリグレッション防止:
 * - Growth 明示要望が pending follow-up / Sheets に吸われない
 * - 混乱シグナルが pending を続行しない
 * - 「できるようにして」系が Drive/Sheets 選択に流れない
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isExplicitGrowthDevelopmentRequest,
  isForcedGrowthOrIssueCommand,
  isUserConfusionOrNegationSignal,
  isExplicitExistingFileOperation,
} from "./growthExplicitRequest.js";

// ────────────────────────────────────────────
// ケース1: Growth 明示要望は pending pick を無視する
// ────────────────────────────────────────────
test("ケース1: 毎朝売上通知は Growth（pending pick があっても）", () => {
  const text = "NEARで毎朝9時に売上を通知できるようにして";
  // Growth 判定が true なら thinRouter が pending pick をバイパスする
  assert.ok(
    isExplicitGrowthDevelopmentRequest(text),
    "毎朝9時に売上を通知できるようにして は Growth 要望として判定されるべき"
  );
  // 混乱シグナルではない
  assert.equal(isUserConfusionOrNegationSignal(text), false);
  // 既存ファイル操作ではない
  assert.equal(isExplicitExistingFileOperation(text), false);
});

// ────────────────────────────────────────────
// ケース2: 混乱シグナル「どういうこと？」は pending を続行しない
// ────────────────────────────────────────────
test("ケース2: 「どういうこと？」は混乱シグナルとして検知", () => {
  const text = "どういうこと？";
  assert.ok(
    isUserConfusionOrNegationSignal(text),
    "「どういうこと？」は混乱シグナルとして検知されるべき"
  );
  // Growth 要望ではない
  assert.equal(isExplicitGrowthDevelopmentRequest(text), false);
});

// ────────────────────────────────────────────
// ケース3: 「は？」は混乱シグナルとして検知
// ────────────────────────────────────────────
test("ケース3: 「は？」は混乱シグナルとして検知", () => {
  const texts = ["は？", "は?", "は！", "はぁ？", "意味わからん"];
  for (const t of texts) {
    assert.ok(
      isUserConfusionOrNegationSignal(t),
      `「${t}」は混乱シグナルとして検知されるべき`
    );
  }
  // 通常のタスク追加では混乱シグナルにならない
  assert.equal(isUserConfusionOrNegationSignal("明日のミーティングをタスクに追加して"), false);
});

// ────────────────────────────────────────────
// ケース4: 「スプレッドシートに自動保存できるようにして」は Growth
// ────────────────────────────────────────────
test("ケース4: スプレッドシートに自動保存できるようにして は Growth（Sheets選択に流さない）", () => {
  const text = "スプレッドシートに自動保存できるようにして";
  assert.ok(
    isExplicitGrowthDevelopmentRequest(text),
    "スプレッドシートに自動保存できるようにして は Growth 要望として判定されるべき"
  );
  assert.equal(isUserConfusionOrNegationSignal(text), false);
});

// ────────────────────────────────────────────
// ケース5: 「新しいスプレッドシートに売上反映できるようにして」は Growth
// ────────────────────────────────────────────
test("ケース5: 新しいスプレッドシートに売上反映できるようにして は Growth（Sheets選択に流さない）", () => {
  const texts = [
    "新しいスプレッドシートに売上反映できるようにして",
    "売上を自動でスプレッドシートに保存して",
    "毎朝9時に売上ランキングをLINE通知して",
  ];
  for (const t of texts) {
    assert.ok(
      isExplicitGrowthDevelopmentRequest(t),
      `「${t}」は Growth 要望として判定されるべき`
    );
  }
});

// ────────────────────────────────────────────
// ケース6: 既存ファイル操作は Growth ではない（既存 Sheets ルートへ）
// ────────────────────────────────────────────
test("ケース6: 既存シート操作は isExplicitGrowthDevelopmentRequest = false", () => {
  // 「このスプレッドシートのタスク一覧出して」は既存ファイル操作
  const existingOps = [
    "このスプレッドシートのタスク一覧出して",
    "POPUP売上管理表を開いて",
    "既存のシートに保存して",
    "1番のシートに反映して",
  ];
  for (const t of existingOps) {
    // Growth として判定されてはいけない（または既存ファイル操作フラグが立つ）
    const isGrowth = isExplicitGrowthDevelopmentRequest(t);
    const isExisting = isExplicitExistingFileOperation(t);
    assert.ok(
      !isGrowth || isExisting,
      `「${t}」は Growth 要望として誤判定されるべきではない（isGrowth=${isGrowth}, isExisting=${isExisting}）`
    );
  }
});

// ────────────────────────────────────────────
// ケース7: 数字「1」は pending pick が存在する場合のみシート選択（Growth/混乱時はバイパス）
// ────────────────────────────────────────────
test("ケース7: 「1」は Growth 要望でも混乱シグナルでもない（pending pick が有効な場合は選択）", () => {
  const text = "1";
  // 「1」単体は Growth でも混乱でもない
  assert.equal(isExplicitGrowthDevelopmentRequest(text), false);
  assert.equal(isUserConfusionOrNegationSignal(text), false);
  // thinRouter は Growth/混乱でなければ pending pick をチェックする（正常動作）
});

// ────────────────────────────────────────────
// 追加: AI 回答でよいものが Growth にならないことを確認
// ────────────────────────────────────────────
test("AI 回答で済むものは Growth 要望にならない", () => {
  const aiTexts = [
    "文面作って",
    "この文章直して",
    "要約して",
    "これどう思う？",
    "Cursorへの指示文作って",
    "シュークリームってどう思う？",
    "シュークリームの宣伝文面を考えて",
    "これもう少し変えて",
  ];
  for (const t of aiTexts) {
    assert.equal(
      isExplicitGrowthDevelopmentRequest(t),
      false,
      `「${t}」は Growth 要望として誤判定されるべきではない`
    );
    assert.equal(
      isUserConfusionOrNegationSignal(t),
      false,
      `「${t}」は混乱シグナルとして誤判定されるべきではない`
    );
  }
});

// ────────────────────────────────────────────
// 追加: Growth 要望の網羅
// ────────────────────────────────────────────
test("Growth 要望として確実に検知されるべきパターン", () => {
  const growthTexts = [
    "NEARで〇〇できるようにして",
    "毎朝通知して",
    "外部APIと連携して",
    "この機能を追加して",
    "GitHub Issueを自動作成できるようにして",
    "LINEで売上を通知できるようにして",
    "売上管理を自動化して",
  ];
  for (const t of growthTexts) {
    assert.ok(
      isExplicitGrowthDevelopmentRequest(t) || isForcedGrowthOrIssueCommand(t),
      `「${t}」は Growth 要望として検知されるべき`
    );
  }
});

// ────────────────────────────────────────────
// 追加: 混乱シグナルの各種バリエーション
// ────────────────────────────────────────────
test("混乱シグナルのバリエーション", () => {
  const confusionTexts = [
    "どういうこと？",
    "は？",
    "意味わからん",
    "ぜんぜんあかん",
    "何の話？",
    "それじゃない",
    "そういうことじゃない",
    "なんかおかしい",
    "違う",
    "番号じゃない",
    "なんで番号を聞くの",
  ];
  for (const t of confusionTexts) {
    assert.ok(
      isUserConfusionOrNegationSignal(t),
      `「${t}」は混乱シグナルとして検知されるべき`
    );
  }

  // 通常発話は混乱シグナルにならない
  const normalTexts = [
    "明日のミーティングをタスクに追加して",
    "タスク一覧を見せて",
    "リマインドして",
    "1番を完了にして",
  ];
  for (const t of normalTexts) {
    assert.equal(
      isUserConfusionOrNegationSignal(t),
      false,
      `「${t}」は混乱シグナルとして誤判定されるべきではない`
    );
  }
});
