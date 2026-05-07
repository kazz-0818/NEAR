# NEAR デプロイ手順

このリポジトリは **Docker** でビルドできます。PaaS のダッシュボードに **環境変数** をそのまま登録してください（`.env` は Git に含めない）。

## `System` 配下で `NEAR` だけをデプロイする設定

`System` フォルダ内に複数プロジェクトを置く場合、デプロイ先の **Root Directory（作業ディレクトリ）を `NEAR`** に設定してください。

- Render: サービス設定の Root Directory を `NEAR` にする
- Railway: サービス設定の Root Directory を `NEAR` にする
- GitHub Actions（もし `System` を親リポジトリとして運用する場合）: `paths` を使って `NEAR/**` の変更時のみ実行する

現在のように `NEAR` 自体が独立した Git リポジトリであれば、追加設定なしでも `NEAR` だけが対象です。

## 必要な環境変数

`.env.example` と同じキーが必要です。本番では少なくとも次を設定します。

| 変数 | 説明 |
|------|------|
| `DATABASE_URL` | Supabase の Pooler URI 推奨（本番も IPv4 のことが多い） |
| `LINE_CHANNEL_SECRET` | LINE Developers |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers |
| `OPENAI_API_KEY` | OpenAI |
| `ADMIN_API_KEY` | 長いランダム文字列（管理 API 用） |
| `PORT` | 未設定なら `3000`。Render 等が自動で付与する場合はそのまま |
| `CRON_SECRET` | 任意（`/internal/reminders/dispatch` を保護する場合） |
| `ADMIN_LINE_USER_ID` | 任意。**成長フロー**で管理者へ「ユーザー個人LINEヒアリング完了後」の要約共有・最終承認・実装指示・進捗を LINE プッシュ（あなたの userId を設定） |
| `GROWTH_AUTO_CODING_ENABLED` | 任意 `true`/`1`。自動コーディング runner を有効化。**下記 GitHub／エージェントが未設定ならスタブ**（手動運用推奨） |
| `GITHUB_TOKEN` | 任意。`GROWTH_GITHUB_REPO` と組み合わせて第二承認後に **GitHub Issue を自動作成**（classic PAT または fine-grained で `issues: write`） |
| `GROWTH_GITHUB_REPO` | 任意。`owner/repo` 形式（例: `kazz-0818/NEAR`）。`GITHUB_TOKEN` とセットで有効 |
| `GROWTH_CODING_AGENT_URL` | 任意。第二承認後に **JSON POST** で `cursorPrompt` を渡す社内エージェントの URL（**GitHub Issue 連携が無効なとき**に使われる。`GITHUB_TOKEN`+`GROWTH_GITHUB_REPO` の両方がある場合は **GitHub を優先**） |
| `GROWTH_CODING_AGENT_SECRET` | 任意。設定時、リクエスト本文の HMAC-SHA256 を `X-NEAR-Signature: sha256=<hex>` で付与 |
| `GROWTH_CODING_AGENT_RPM` | 任意。エージェント POST のレート上限（**1分あたり**、既定 `10`） |
| `GROWTH_AUTO_DEPLOY_ENABLED` | 任意 `true`/`1`。自動デプロイ runner（**未接続時はスタブ**。本番は既定オフ推奨） |
| `GROWTH_SUGGESTION_GATE_ENABLED` | 任意 `false`/`0` で無効＝**毎回** suggestion。有効時（既定）はルール通過時だけ suggestion（[`growth_suggestion_gate`](src/services/growth_suggestion_gate.ts)） |
| `GROWTH_SKIP_OUT_OF_SCOPE` | 既定オン相当。`false` で `out_of_scope` も提案対象に |
| `GROWTH_SKIP_WHEN_FOLLOWUP` | 既定オン相当。`needs_followup` 時は suggestion 保留 |
| `GROWTH_MIN_MESSAGE_CHARS` | 既定 `12`。未満はログのみ（`growth_skipped`）。`0` で無効 |
| `GROWTH_MIN_FINGERPRINT_COUNT` | 既定 `1`（初回から成長候補化）。スパム抑制で `2` 以上にすると同一要約が溜まるまで保留 |
| `GROWTH_MIN_CONFIDENCE_UNKNOWN` | 既定 `0.35`。`unknown_custom_request` かつ低 confidence はスキップ。`0` で無効 |
| `NEAR_GROWTH_ADMIN_NOTIFY_ON_SUGGESTION` | 任意 `true`/`1` で有効。**旧フロー互換**で提案作成直後に成長カプセルへ第一段階通知。未設定（既定）はオフ＝ユーザー個人LINEヒアリング完了後に初回共有 |
| `PUBLIC_BASE_URL` | 任意。通知に `…/admin/suggestions/:id` のリンクを載せるとき（例: `https://near-xxx.onrender.com`、末尾スラッシュなし）。**Render では未設定でも `RENDER_EXTERNAL_URL` に自動フォールバック** |
| `LINE_BOT_USER_ID` | 任意。グループ／トークルームでは **@ボットのメンション** か **本文に「NEAR」「ニア」** がないと返信しない（1:1 は従来どおり）。メンション判定に使う。`curl -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" https://api.line.me/v2/bot/info` の `userId` |
| `NEAR_WHATS_NEW` | 任意。改行可。「最近できるようになったこと」を NEAR が短く話すときの本文（デプロイごとに手更新） |
| `NEAR_SECRETARY_LAYER_DISABLED` | 任意 `true`/`1`。有効時は**秘書レイヤー**（直前返答の編集短絡・確認短絡）をオフにし、従来の intent ルートのみにする（障害時の切り分け用） |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 任意。**Google Sheets 読み取り**。サービスアカウント鍵の JSON 文字列（1行推奨）。改行が難しいときは `GOOGLE_SERVICE_ACCOUNT_JSON_B64` |
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | 任意。上記 JSON を base64 エンコードしたもの（Render 等向け） |
| `GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID` | 任意。全員共通の既定ブック ID（URL の `/d/` と次の `/` の間） |
| `GOOGLE_SHEETS_MAX_ROWS` | 任意。1シートあたり読み取る最大行数（既定 `400`、20〜2000） |
| `GOOGLE_OAUTH_CLIENT_ID` | 任意。**ユーザー Google OAuth** 用（Web クライアント ID） |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 任意。上記クライアントのシークレット |
| `GOOGLE_OAUTH_REDIRECT_URI` | 任意。**完全一致**で Google Cloud に登録。例: `https://<本番ホスト>/oauth/google/callback` |
| `GOOGLE_OAUTH_TOKEN_SECRET` | 任意。refresh_token 暗号化用（**16文字以上**、漏洩厳禁） |

初回起動時に `ensureSchema()` が DB マイグレーション相当を流します（`001` 〜 `012_user_google_oauth_multi.sql` など）。

## Google スプレッドシート（読み取り）

LINE 上で「POPUPシートの7月の売上は？」のように聞くと、NEAR が **Sheets API で表を取得**し、**AI がシートを選んで内容を解釈**して答えます（[`src/modules/sheets_query.ts`](src/modules/sheets_query.ts)）。

認証は次の **どちらか一方または両方**を設定できます。

### A. サービスアカウント（従来）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作り、**Google Sheets API** と **Google Drive API** を有効化する（リンク無しの**ファイル名検索**に Drive が必要です）。
2. **サービスアカウント**を作成し、JSON 鍵をダウンロードする。
3. 鍵の `client_email`（`….iam.gserviceaccount.com`）をコピーする。
4. 参照したいスプレッドシートの **共有**で、そのメールアドレスに **閲覧者**（または編集者）を追加する。
5. NEAR の環境変数に `GOOGLE_SERVICE_ACCOUNT_JSON`（または `_B64`）を設定してデプロイする。

### B. ユーザー OAuth（自分の Google 権限で読む）

サービスアカウントに共有しなくても、**ユーザー本人の Google で開けるシート**を読み取れます。

1. 同じ（または別）GCP プロジェクトで **OAuth クライアント ID（ウェブアプリケーション）** を作成する。
2. **承認済みのリダイレクト URI** に `https://<本番>/oauth/google/callback` を**完全一致**で追加する。
3. **Google Sheets API** と **Google Drive API** を有効にする。カレンダー連携（予定の一覧・追加）を使う場合は **Google Calendar API** も有効にする。
4. （外部ユーザーに使わせる場合）**OAuth 同意画面**で次を追加し、テストユーザーまたは本番公開を設定する: `openid` / `email` / `userinfo.profile`（アカウント識別・表示用）、`.../auth/spreadsheets.readonly`、`.../auth/drive.metadata.readonly`（Drive のファイル名検索）、`.../auth/calendar.events`（カレンダー予定の読み書き・primary）。
5. 環境変数に `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` / `GOOGLE_OAUTH_TOKEN_SECRET` を設定する。
6. `PUBLIC_BASE_URL`（または Render の `RENDER_EXTERNAL_URL`）が連携 URL の生成に使われる。

**利用者の操作:** LINE で **「Google連携」** と送る → 返信の URL をブラウザで開く → Google で許可。refresh_token は DB に暗号化保存されます。**2つ目の Google** も同じ「Google連携」で追加できます（ブラウザで別アカウントを選択）。**「Googleアカウント一覧」**で確認、**「Google 2」「2番のGoogle」**で利用中アカウントを切り替えます。

エンドポイント: `GET /oauth/google/start?link=…` → Google へリダイレクト → `GET /oauth/google/callback`。

### 読み取りの優先順位

同一ユーザーで **OAuth 連携済みならユーザーのトークンを優先**し、無ければサービスアカウントを使います。

**ブックの指定**

- **Google 連携済み**のとき、メッセージ内のキーワードから **Drive 上のファイル名**を検索し、スプレッドシートを自動特定することがあります（名前に「購入代行」「管理」などが含まれる場合など）。
- メッセージに `https://docs.google.com/spreadsheets/d/xxxxxxxx/edit…` を含める、または
- `GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID` を設定する、または
- 一度「このシートを既定にして」と **URL 付き**で送ると、`user_sheet_defaults` に LINE ユーザー単位で保存される（[`007_user_sheet_defaults.sql`](src/db/migrations/007_user_sheet_defaults.sql)）。

**注意（再連携）:** 以前は `spreadsheets.readonly` のみだった場合、**Drive 検索**のために LINE で「Google連携」をもう一度行い、新しいスコープを許可する必要があります。

**注意:** 巨大なシートは先頭〜`GOOGLE_SHEETS_MAX_ROWS` 行・列 ZZ までに限ります。書き込みは行いません（読み取り専用スコープ）。

## NEAR 成長システム（運用の流れ）

1. ユーザーが未対応依頼をすると `unsupported_requests` に保存され、条件を満たすと `implementation_suggestions` が作成されます。ユーザーにはまず「この場で進化ヒアリングを始めるか」を個人LINEで確認します。弾かれた行は `status=growth_skipped` と `notes` に理由が残ります（[`growth_suggestion_gate.ts`](src/services/growth_suggestion_gate.ts)）。
2. ユーザーが同意すると、個人LINEでヒアリングを実施し、回答を `growth_hearing_items` / `required_information` に集約します。
3. ヒアリング完了後に、`ADMIN_LINE_USER_ID` または `GROWTH_APPROVAL_GROUP_ID` へ要約共有＋**最終承認**依頼が届きます。`growth_admin_sessions` でアクティブ提案が紐づきます。
4. 管理者は LINE で「はい／いいえ」→（はいの場合）**Cursor 向け指示の再生成＋プッシュ**、の順で進めます。メッセージ例: 進行中は `テスト完了`→`デプロイ準備OK`→実装後 `成長完了`（または管理 API の `complete`）。
5. 管理 API（`Authorization: Bearer <ADMIN_API_KEY>`）の例:
   - `GET /admin/suggestions?status=pending` … 第一段階 `approval_status` フィルタ
   - `GET /admin/suggestions/:id` … 1件（JSON。`cursor_prompt` に全文）
   - `GET /admin/suggestions/:id/cursor-prompt` … **`cursor_prompt` 本文のみ**（`text/plain`。CLI でファイル化しやすい）
   - `GET /admin/suggestions/:id/hearing` … ヒアリング Q&A
   - `PATCH /admin/suggestions/:id` … `approval_status`（`pending`→`approved`|`rejected`）、`implementation_state`、`deploy_safety_confirmed`（`deploying` へ進むとき必須）、`failure_reason` / `review_notes`
   - `POST /admin/suggestions/:id/growth/second-approve` … 第二承認相当（LINE と同じ処理）
   - `POST /admin/suggestions/:id/growth/complete` … 成長完了（`capability_registry` 追記・通知）
6. **自動コーディング／自動デプロイ**は `coding_runner` / `deploy_runner` のアダプタ差し替えで拡張します。`GROWTH_AUTO_CODING_ENABLED` がオンのとき、`GITHUB_TOKEN`+`GROWTH_GITHUB_REPO` があれば **Issue 作成**、なければ `GROWTH_CODING_AGENT_URL` があれば **エージェント POST**、どちらもなければ **スタブ**です。

設計メモはリポジトリ内 `GROWTH.md` を参照してください。

## NEAR → Cursor（手動運用の標準）

第二承認まで進むと、サーバーが **Cursor 向け実装指示（Markdown 1 本）** を `implementation_suggestions.cursor_prompt` に保存し、管理者 LINE にも概要が届きます。**LINE 本文は長いと省略される**ため、**全文は必ず管理 API から取得**してください。

1. `PUBLIC_BASE_URL` を設定しておくと、通知にベース URL の案内を載せやすくなります（任意）。
2. 第二承認直後、次のいずれかで **全文**を取得する:
   - `curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" "$PUBLIC_BASE_URL/admin/suggestions/<id>" | jq -r '.cursor_prompt' > task.md`
   - または `curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" "$PUBLIC_BASE_URL/admin/suggestions/<id>/cursor-prompt" -o task.md`
3. ローカルで NEAR リポジトリを開いた **Cursor** の Composer / Agent に `task.md` の内容を貼り、実装・`npm run build`・動作確認を行う。
4. 完了後、管理者 LINE で「成長完了」、または `POST /admin/suggestions/<id>/growth/complete`。

半自動にする場合は `GROWTH_AUTO_CODING_ENABLED` と `GITHUB_TOKEN` / `GROWTH_CODING_AGENT_URL` を参照してください（上表）。

### 社内エージェント（`GROWTH_CODING_AGENT_URL`）の受信形式

第二承認時に **POST**（`Content-Type: application/json`）で次の JSON が送られます。

```json
{ "source": "near", "suggestionId": 123, "cursorPrompt": "…Markdown 全文…" }
```

`GROWTH_CODING_AGENT_SECRET` を設定した場合、同じ生本文の HMAC-SHA256（16進）がヘッダ `X-NEAR-Signature: sha256=<hex>` に入ります（共有秘密で改ざん検知用）。**1 分あたりの送信回数**は `GROWTH_CODING_AGENT_RPM`（既定 10）で抑えます。

## LINE Webhook

デプロイ後に表示される **`https://<あなたのホスト>/webhook/line`** を LINE Developers の Webhook URL に設定し、検証してください。ngrok は不要になります。

---

## Render（例）

1. [Render](https://render.com) にログイン → **New +** → **Blueprint** または **Web Service**
2. GitHub リポジトリを接続（NEAR を push しておく）
3. **Docker** を選択し、ルートに `Dockerfile` があることを確認
4. **Environment** に上表の変数を追加
5. **Deploy**。URL が発行されたら LINE の Webhook を更新

`render.yaml` を使う場合は **Blueprint** からリポジトリを指定。

**ブラウザで確認:** デプロイ後、発行された URL の**ルート**（例: `https://near-xxxx.onrender.com/`）を開くと、公開 URL・`/health`・**Render ダッシュボード（このサービス）**へのリンクが表示されます。稼働確認は `GET /health`（JSON に `render`・`public_base_url` が含まれる場合あり）。

**自動ビルド・自動デプロイ:** `main` へ push すると [`.github/workflows/ci.yml`](.github/workflows/ci.yml) で `npm run build` が走ります。`render.yaml` は **`autoDeployTrigger: commit`**（push 直後に Render がデプロイ。CI 完了を待たない）です。デプロイ前に CI 成功を必須にしたい場合は `checksPass` に変更し、Render ダッシュボードで GitHub 連携を確認してください。

**GitHub でワークフローが「承認が必要」と止まる場合:** リポジトリ **Settings → Actions → General** で、フォークからの PR や初回コントリビュータの承認ポリシーを確認してください。組織リポジトリならオーナーに **Actions を有効化**してもらう必要があります（リポジトリの YAML だけでは解除できません）。

**Cursor などエディタの「RUN（コマンド実行）を毎回確認」:** リポジトリ外の **Cursor / VS Code の設定**（エージェントの自動承認・ターミナル権限）で変えます。この NEAR リポジトリのファイルでは制御しません。

---

## Railway（例）

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. リポジトリ選択。`Dockerfile` を検出してビルド
3. サービス → **Variables** に環境変数を追加
4. **Settings → Networking → Generate Domain** で HTTPS URL を取得
5. Webhook URL を `https://<domain>/webhook/line` に設定

`railway.json` は Docker ビルド用の補助です。

---

## ローカルで Docker 試験

```bash
docker build -t near .
docker run --rm -p 3000:3000 --env-file .env near
```

`curl http://localhost:3000/health` で確認。
