# NEAR Growth — 通常 Cursor Agent ルートのテスト用 Issue 本文

GitHub で Issue を作成し、本文に以下を貼り付けてください。

使用ラベル:

- `near-growth`
- `cursor-agent`

---

## suggestion_id

43

## 目的

通常の Cursor Agent ルートでPR作成まで進むか確認する。

## 実装要件

必ずリポジトリ直下の README.md を編集してください。

README.md の末尾に以下の1文を追加してください。

Cursor Agentによる自動PR作成テストに対応しました。

## 絶対条件

- 必ずREADME.mdに差分を発生させること
- src配下は変更しないこと
- package.json / package-lock.json は変更しないこと
- mainへ直接pushしないこと
- npm run build を通すこと

## 完了条件

- README.md に指定文言が追加されている
- npm run build が通る
- PRが作成される
