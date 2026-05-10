#!/usr/bin/env bash
# NEAR Growth Automation (v2): Issue をトリガーに Cursor CLI で実装し、PR まで作成する。
# - CURSOR_API_KEY はログに出さない
# - gh は GH_TOKEN（github.token）を使用

set -euo pipefail

ISSUE_NUMBER="${ISSUE_NUMBER:?ISSUE_NUMBER required}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
WORKDIR="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE required}"

MARKER_PR='<!-- NEAR_GROWTH_AUTOMATION_PR -->'
MARKER_NO_DIFF='<!-- NEAR_GROWTH_AUTOMATION_NO_DIFF -->'
MARKER_FAIL='<!-- NEAR_GROWTH_AUTOMATION_FAIL -->'

cd "$WORKDIR"

log() {
  echo "[near-growth] $*" >&2
}

redact_snippet() {
  sed -E \
    -e 's/(CURSOR_API_KEY|GITHUB_TOKEN|GH_TOKEN|OPENAI_API_KEY|SECRET|PASSWORD|BEARER)\s*[=:]\s*\S+/[REDACTED]/Ig' \
    -e 's/sk-[a-zA-Z0-9]{10,}/[REDACTED]/g' \
    -e 's/ghp_[a-zA-Z0-9]{10,}/[REDACTED]/g' \
    -e 's/gho_[a-zA-Z0-9]{10,}/[REDACTED]/g' \
    -e 's/postgresql:\/\/[^ ]+/[REDACTED_DB]/Ig' \
    | tail -n 40
}

issue_labels_json() {
  gh api "repos/${REPO}/issues/${ISSUE_NUMBER}/labels" --jq '.[].name' 2>/dev/null || true
}

has_label() {
  local want="$1"
  issue_labels_json | grep -Fxq "$want"
}

issue_comment_bodies() {
  gh api "repos/${REPO}/issues/${ISSUE_NUMBER}/comments" --jq '.[].body' 2>/dev/null || true
}

try_create_label() {
  local name="$1"
  local color="${2:-EDEDED}"
  gh label create "$name" --color "$color" --description "NEAR Growth Automation" -R "$REPO" 2>/dev/null || true
}

# --- ゲート ---
if has_label "near-growth-pr-created"; then
  log "skip: near-growth-pr-created が付いています"
  exit 0
fi

if ! has_label "near-growth" || ! has_label "cursor-agent"; then
  log "skip: near-growth と cursor-agent の両方が必要です"
  exit 0
fi

BODY_FILE="$(mktemp)"
PROMPT_FILE="$(mktemp)"
PR_BODY_FILE="$(mktemp)"
AGENT_LOG=""
BUILD_LOG=""
cleanup() {
  rm -f "$BODY_FILE" "$PROMPT_FILE" "$PR_BODY_FILE" "${AGENT_LOG:-}" "${BUILD_LOG:-}" 2>/dev/null || true
}
trap cleanup EXIT

gh issue view "$ISSUE_NUMBER" -R "$REPO" --json body -q .body >"$BODY_FILE"

SUGGESTION_ID=""
if grep -qE '^## suggestion_id[[:space:]]*$' "$BODY_FILE"; then
  SUGGESTION_ID="$(grep -A1 -E '^## suggestion_id[[:space:]]*$' "$BODY_FILE" | tail -n1 | tr -d ' \t\r')"
fi
if ! [[ "$SUGGESTION_ID" =~ ^[0-9]+$ ]]; then
  SUGGESTION_ID="$(grep -oE 'suggestion_id[D:=[:space:]]+[0-9]{1,12}' "$BODY_FILE" | grep -oE '[0-9]{1,12}$' | head -1 || true)"
fi
if ! [[ "$SUGGESTION_ID" =~ ^[0-9]+$ ]]; then
  log "error: suggestion_id を抽出できませんでした"
  try_create_label "near-growth-agent-failed" "D93F0B"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

Cursor Agent実行に失敗しました。

原因:
Issue 本文から suggestion_id を読み取れませんでした（\`## suggestion_id\` の直後に数値があるか確認してください）。

確認してください:
- Issue が NEAR Growth Automation v1 で作成されたフォーマットか
- \`## suggestion_id\` セクションが欠けていないか
"
  fi
  exit 1
fi

BRANCH="near-growth/suggestion-${SUGGESTION_ID}"

EXISTING_PR="$(gh pr list -R "$REPO" --head "$BRANCH" --state all --json number -q '.[0].number // empty' 2>/dev/null || true)"
if [[ -n "${EXISTING_PR:-}" ]]; then
  log "skip: ブランチ ${BRANCH} に対する PR #${EXISTING_PR} が既に存在します"
  exit 0
fi

if git ls-remote --heads origin "refs/heads/${BRANCH}" | grep -q .; then
  log "skip: リモートにブランチ ${BRANCH} が既にあります（PR なし）"
  try_create_label "near-growth-agent-failed" "D93F0B"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

同名ブランチ \`${BRANCH}\` がリモートに既に存在し、PR が見つかりませんでした。重複実装を避けるため自動処理を中止しました。ブランチと PR の状態を確認してください。
"
  fi
  exit 0
fi

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  log "error: CURSOR_API_KEY が設定されていません"
  try_create_label "near-growth-agent-failed" "D93F0B"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

Cursor Agent実行に失敗しました。

原因:
CURSOR_API_KEY が GitHub Secrets に設定されていないか、ワークフローに渡っていません。

確認してください:
- CURSOR_API_KEY がGitHub Secretsに設定されているか
- Cursor CLIの利用権限があるか
- GitHub Actionsのpermissionsが足りているか
- npm run build がローカルで通るか
"
  fi
  exit 1
fi

DEFAULT_BRANCH="$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name)"
git fetch origin "$DEFAULT_BRANCH"
git checkout -B "$BRANCH" "origin/${DEFAULT_BRANCH}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

install_deps() {
  if [[ -f pnpm-lock.yaml ]]; then
    corepack enable
    pnpm install --frozen-lockfile
  elif [[ -f yarn.lock ]]; then
    yarn install --frozen-lockfile 2>/dev/null || yarn install --immutable
  elif [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
}

log "install dependencies"
install_deps

log "install Cursor CLI"
curl https://cursor.com/install -fsS | bash
echo "$HOME/.cursor/bin" >>"$GITHUB_PATH"
export PATH="$HOME/.cursor/bin:$PATH"

if ! command -v agent >/dev/null 2>&1; then
  log "error: agent コマンドが見つかりません"
  try_create_label "near-growth-agent-failed" "D93F0B"
  exit 1
fi

{
  cat <<'PREAMBLE'
あなたは NEAR Growth Automation の実装 Agent です。

【必須の振る舞い】
- このリポジトリ内の既存設計を壊さず、最小差分で実装してください。
- git の branch 作成・commit・push、GitHub PR の作成は行わないでください（CI が実行します）。
- main / master へ直接 push しないでください。
- secrets / 環境変数 / API キーをログ・コード・コメント・Issue・PR 本文に書かないでください。
- 既存の LINE 返信、成長システム、タスク管理、スプレッドシート連携を壊さないでください。
- DB migration を追加した場合は ensureSchema の MIGRATION_FILES にファイル名を追加してください。
- TypeScript の型エラーを残さないでください。
- `npm run build` が通る状態にしてください。
- 実装内容が曖昧な場合は、破壊的変更をせず、TODO コメントではなく安全なフォールバックを入れてください。

【実装対象（Issue 本文）】

PREAMBLE
  cat "$BODY_FILE"
} >"$PROMPT_FILE"

log "run Cursor Agent (headless)"
set +e
AGENT_LOG="$(mktemp)"
agent -p --force --trust --workspace "$WORKDIR" --output-format text "$(cat "$PROMPT_FILE")" >"$AGENT_LOG" 2>&1
AGENT_EXIT=$?
set -e
if [[ "$AGENT_EXIT" -ne 0 ]]; then
  log "agent exited with $AGENT_EXIT"
  try_create_label "near-growth-agent-failed" "D93F0B"
  SAFE_TAIL="$(redact_snippet <"$AGENT_LOG" || true)"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

Cursor Agent実行に失敗しました。

原因:
Cursor CLI が異常終了しました（終了コード ${AGENT_EXIT}）。詳細は Actions のログを確認してください。

サニタイズ済み出力末尾:
\`\`\`
${SAFE_TAIL:-（なし）}
\`\`\`

確認してください:
- CURSOR_API_KEY がGitHub Secretsに設定されているか
- Cursor CLIの利用権限があるか
- GitHub Actionsのpermissionsが足りているか
- npm run build がローカルで通るか
"
  fi
  exit 1
fi

log "npm run build"
set +e
BUILD_LOG="$(mktemp)"
npm run build >"$BUILD_LOG" 2>&1
BUILD_EXIT=$?
set -e
if [[ "$BUILD_EXIT" -ne 0 ]]; then
  log "build failed"
  try_create_label "near-growth-agent-failed" "D93F0B"
  SAFE_TAIL="$(redact_snippet <"$BUILD_LOG" || true)"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

Cursor Agent実行後の \`npm run build\` に失敗しました。PR は作成していません。

原因:
build が終了コード ${BUILD_EXIT} で失敗しました。

サニタイズ済みログ末尾:
\`\`\`
${SAFE_TAIL:-（なし）}
\`\`\`

確認してください:
- ローカルで \`npm run build\` が通るか
- エージェント変更に型エラーが含まれていないか
"
  fi
  exit 1
fi

if git diff --quiet && git diff --cached --quiet; then
  log "no file changes"
  if ! issue_comment_bodies | grep -Fq "$MARKER_NO_DIFF"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_NO_DIFF}

実装の結果、リポジトリに差分はありませんでした（PR は作成していません）。
"
  fi
  exit 0
fi

git add -A
git commit -m "feat(growth): suggestion #${SUGGESTION_ID} (issue #${ISSUE_NUMBER})"

git push -u origin "$BRANCH"

ISSUE_URL="https://github.com/${REPO}/issues/${ISSUE_NUMBER}"
cat >"$PR_BODY_FILE" <<EOF
## NEAR Growth Automation PR

元Issue:
- #${ISSUE_NUMBER}

suggestion_id:
- ${SUGGESTION_ID}

## 実装内容
- Cursor Agent が Issue の実装指示に基づきコードを更新しました（差分を参照してください）。

## 確認事項
- [ ] npm run build 通過
- [ ] main直接pushなし
- [ ] secrets出力なし
- [ ] 既存LINE応答への影響確認
- [ ] DB migrationがある場合 ensureSchema に追加済み

## 管理者確認
LINEで「反映して」と言われるまではmainにマージしない。

（元Issue: ${ISSUE_URL}）
EOF

set +e
PR_RAW="$(gh pr create -R "$REPO" \
  --base "$DEFAULT_BRANCH" \
  --head "$BRANCH" \
  --title "feat(growth): suggestion #${SUGGESTION_ID}" \
  --body-file "$PR_BODY_FILE" 2>&1)"
PR_EC=$?
set -e
PR_URL="$(printf '%s\n' "$PR_RAW" | grep -E '^https://[^ ]+/pull/[0-9]+' | tail -n1 | tr -d '\r')"
if [[ "$PR_EC" -ne 0 ]] || [[ -z "$PR_URL" ]] || [[ "$PR_URL" != https://* ]]; then
  log "error: gh pr create failed"
  try_create_label "near-growth-agent-failed" "D93F0B"
  exit 1
fi

if ! issue_comment_bodies | grep -Fq "$MARKER_PR"; then
  gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_PR}

Cursor Agentによる実装PRを作成しました。

PR:
${PR_URL}

管理者確認後、NEAR側で「反映して」に進めます。
"
fi

try_create_label "near-growth-pr-created" "0E8A16"
gh issue edit "$ISSUE_NUMBER" -R "$REPO" --add-label "near-growth-pr-created" 2>/dev/null || true

log "done: ${PR_URL}"
exit 0
