# NEAR Growth Automation — 運用ルール（v4）

## リポジトリの正

- **GitHub の `main`（または運用で決めた既定ブランチ）を正**とします。
- NEAR Growth Automation（Issue → Actions → Cursor Agent → PR → マージ）は GitHub 上で完結します。

## ローカル開発フォルダは自動では追従しない

- **`main` が更新されても、赤井さんの Mac 内の NEAR フォルダは自動では更新されません。**
- PC を閉じている・オフラインの間は、ローカルで `git pull` も実行されません。
- **NEAR の進化完了通知（LINE）を受け取ったら、次回 Cursor で触る前に必ず同期してください。**

## 推奨ローカル同期コマンド

NEAR が自動で GitHub の `main` を更新しても、**赤井さんの Mac 上の NEAR フォルダは自動では更新されません。**

PC を閉じている間は、ローカルへ `git pull` が走ることもありません。

最新化するときは、まず作業ツリーに未コミットの変更がないか確認し、必要なら **先に commit するか `git stash`** してから pull してください。

```bash
cd ~/Downloads/System/NEAR
git pull origin main
git status
```

**Cursor で NEAR を触る前に**、必ず `git status` と `git pull` の結果を確認してください。

別パスで clone している場合は、`cd` だけ環境に合わせてください（サーバー側の環境変数 `NEAR_LOCAL_SYNC_PATH_HINT` で Issue/PR 本文・LINE 案内のパスを変えられます）。

## Growth の理想フロー

```
ユーザー/管理者が明示的に機能追加を依頼
↓
Growth 候補として整理（growth_pipeline）
↓
管理者承認（tryHandleAdminGrowthLine）
↓
GitHub Issue 作成（near-growth / cursor-agent ラベル）
↓
Cursor Agent が PR 作成（GitHub Actions）
↓
管理者が LINE で「反映して」
↓
安全チェック（CI 成功 / base=main / head プレフィックス / コンフリクトなし）
↓
main へマージ
↓
進化完了通知（LINE）:
  「NEARの進化が完了しました。
   PR: {pr_url}
   Issue: {issue_url}
   最新コミット: {commit_sha}
   ローカル同期コマンド:
   cd ~/Downloads/System/NEAR
   git pull origin main
   git status」
```

## 管理者向け: PR を `main` に載せる

- Actions が作った Growth PR は、原則 **`near-growth/` で始まる head** のみ、管理者 LINE の **「反映して」** 等で自動マージの対象にします。
- マージ前に **GitHub のチェックが失敗している・実行中のときは自動マージしません**。コンフリクトや base が想定外のときも同様です。
- 詳細は `GROWTH_MERGE_*` / `GROWTH_LINE_MERGE_ENABLED` を参照してください。

## Improvement Capsule との違い

| | Growth | Improvement Capsule |
|---|--------|---------------------|
| 起点 | ユーザー/管理者が**明示的に機能追加を依頼** | NEAR が**会話品質の改善余地を自動検知** |
| LLM 分析 | 依頼時（feature_suggester） | **日次バッチのみ**（毎会話では呼ばない） |
| Issue ラベル | `near-growth` `cursor-agent` | + `improvement-capsule` |
| 詳細 | 本書 + GROWTH.md | docs/near-improvement-capsules.md |

## 注意（セキュリティ）

- **API キーやトークンを LINE・Issue・ログに出さない**でください。
- リモートから赤井さんの Mac に対して `git pull` を実行することはありません（案内テキストのみです）。
- main へ直接 push しない、PR マージは管理者「反映して」後のみ。
- GitHub Actions 失敗中・失敗済みの PR はマージしない。
