# NEAR Growth Automation — 運用ルール（v4）

## リポジトリの正

- **GitHub の `main`（または運用で決めた既定ブランチ）を正**とします。
- NEAR Growth Automation（Issue → Actions → Cursor Agent → PR → マージ）は GitHub 上で完結します。

## ローカル開発フォルダは自動では追従しない

- **`main` が更新されても、赤井さんの Mac 内の NEAR フォルダは自動では更新されません。**
- PC を閉じている・オフラインの間は、ローカルで `git pull` も実行されません。
- **NEAR の進化完了通知（LINE）を受け取ったら、次回 Cursor で触る前に必ず同期してください。**

## 推奨ローカル同期コマンド

```bash
cd ~/Downloads/System/NEAR
git pull origin main
git status
```

別パスで clone している場合は、`cd` だけ環境に合わせてください（サーバー側の環境変数 `NEAR_LOCAL_SYNC_PATH_HINT` で Issue/PR 本文の案内パスを変えられます）。

## 管理者向け: PR を `main` に載せる

- Actions が作った Growth PR は、原則 **`near-growth/` で始まる head** のみ、管理者 LINE の **「反映して」** 等で自動マージの対象にします。
- マージ前に **GitHub のチェックが失敗している・実行中のときは自動マージしません**。コンフリクトや base が想定外のときも同様です。
- 詳細は `GROWTH_MERGE_*` / `GROWTH_LINE_MERGE_ENABLED` を参照してください。

## 注意（セキュリティ）

- **API キーやトークンを LINE・Issue・ログに出さない**でください。
- リモートから赤井さんの Mac に対して `git pull` を実行することはありません（案内テキストのみです）。
