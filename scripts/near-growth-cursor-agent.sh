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
MARKER_LINKED_PR='<!-- NEAR_GROWTH_SKIP_LINKED_PR -->'

cd "$WORKDIR"

RUNNING_ADDED=0

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

add_running_label() {
  try_create_label "near-growth-agent-running" "FBCA04"
  gh issue edit "$ISSUE_NUMBER" -R "$REPO" --add-label "near-growth-agent-running" 2>/dev/null || true
  RUNNING_ADDED=1
}

remove_running_label() {
  if [[ "$RUNNING_ADDED" == 1 ]]; then
    gh issue edit "$ISSUE_NUMBER" -R "$REPO" --remove-label "near-growth-agent-running" 2>/dev/null || true
    RUNNING_ADDED=0
  fi
}

extract_suggestion_id() {
  local body_file="$1"
  local sid=""

  if grep -qE '^## suggestion_id[[:space:]]*$' "$body_file"; then
    sid="$(grep -A1 -E '^## suggestion_id[[:space:]]*$' "$body_file" | tail -n1 | tr -d ' \t\r')"
  fi
  if ! [[ "$sid" =~ ^[0-9]+$ ]]; then
    sid="$(grep -oiE 'suggestion[[:space:]]*#[[:space:]]*[0-9]{1,12}\>' "$body_file" | head -1 | grep -oE '[0-9]{1,12}$' || true)"
  fi
  if ! [[ "$sid" =~ ^[0-9]+$ ]]; then
    sid="$(grep -oiE 'suggestion_id[[:space:]]*=[[:space:]]*[0-9]{1,12}' "$body_file" | grep -oE '[0-9]{1,12}$' | head -1 || true)"
  fi
  if ! [[ "$sid" =~ ^[0-9]+$ ]]; then
    sid="$(grep -oiE 'suggestion_id[D:=[:space:]]+[0-9]{1,12}' "$body_file" | grep -oE '[0-9]{1,12}$' | head -1 || true)"
  fi

  printf '%s' "$sid"
}

find_open_pr_for_this_issue() {
  local n url b
  while IFS= read -r n; do
    [[ -z "${n:-}" ]] && continue
    b=$(gh pr view "$n" -R "$REPO" --json body -q .body 2>/dev/null || true)
    if printf '%s' "$b" | grep -qF "## NEAR Growth Automation PR" && printf '%s' "$b" | grep -qF "元Issue:" && printf '%s' "$b" | grep -qF "#${ISSUE_NUMBER}"; then
      url=$(gh pr view "$n" -R "$REPO" --json url -q .url 2>/dev/null || true)
      printf '%s\t%s' "$n" "${url:-}"
      return 0
    fi
  done < <(gh pr list -R "$REPO" --state open --limit 100 --json number -q '.[].number')
  return 1
}

BODY_FILE=""
PROMPT_FILE=""
PR_BODY_FILE=""
AGENT_LOG=""
BUILD_LOG=""

cleanup_files() {
  rm -f "${BODY_FILE:-}" "${PROMPT_FILE:-}" "${PR_BODY_FILE:-}" "${AGENT_LOG:-}" "${BUILD_LOG:-}" 2>/dev/null || true
}

on_exit() {
  remove_running_label
  cleanup_files
}
trap on_exit EXIT

# --- ゲート ---
if has_label "near-growth-pr-created"; then
  log "skip: near-growth-pr-created が付いています"
  exit 0
fi

if has_label "near-growth-agent-running"; then
  log "skip: near-growth-agent-running が付いています（別実行中または前回のラベル残り。必要なら手動で外してください）"
  exit 0
fi

if ! has_label "near-growth" || ! has_label "cursor-agent"; then
  log "skip: near-growth と cursor-agent の両方が必要です"
  exit 0
fi

BODY_FILE="$(mktemp)"
PROMPT_FILE="$(mktemp)"
PR_BODY_FILE="$(mktemp)"

gh issue view "$ISSUE_NUMBER" -R "$REPO" --json body -q .body >"$BODY_FILE"

SUGGESTION_ID="$(extract_suggestion_id "$BODY_FILE")"
if [[ "$SUGGESTION_ID" =~ ^[0-9]+$ ]]; then
  BRANCH="near-growth/suggestion-${SUGGESTION_ID}"
  SUGGESTION_LINE="${SUGGESTION_ID}"
  PR_TITLE="feat(growth): suggestion #${SUGGESTION_ID}"
  COMMIT_MSG="feat(growth): suggestion #${SUGGESTION_ID} (issue #${ISSUE_NUMBER})"
else
  SUGGESTION_ID=""
  BRANCH="near-growth/issue-${ISSUE_NUMBER}"
  SUGGESTION_LINE="（抽出不可） issue-${ISSUE_NUMBER} をブランチ名に使用"
  PR_TITLE="feat(growth): issue #${ISSUE_NUMBER}"
  COMMIT_MSG="feat(growth): issue #${ISSUE_NUMBER} (suggestion_id 未抽出)"
fi

if LINKED="$(find_open_pr_for_this_issue)"; then
  PR_NUM="${LINKED%%$'\t'*}"
  PR_URL_EXISTING="${LINKED#*$'\t'}"
  log "skip: この Issue に紐づく未マージ PR が既にあります (#${PR_NUM})"
  if ! issue_comment_bodies | grep -Fq "$MARKER_LINKED_PR"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_LINKED_PR}

既に NEAR Growth 用の PR が開いています。新規 PR は作成しません。

PR:
${PR_URL_EXISTING}
"
  fi
  exit 0
fi

EXISTING_ROW="$(gh pr list -R "$REPO" --head "$BRANCH" --state all --json number,url -q 'if length > 0 then "\(.[0].number)\t\(.[0].url)" else empty end' 2>/dev/null || true)"
if [[ -n "${EXISTING_ROW:-}" ]]; then
  EX_PR_NUM="${EXISTING_ROW%%$'\t'*}"
  EX_PR_URL="${EXISTING_ROW#*$'\t'}"
  log "skip: ブランチ ${BRANCH} に対する PR #${EX_PR_NUM} が既に存在します"
  if ! issue_comment_bodies | grep -Fq "$MARKER_LINKED_PR"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_LINKED_PR}

同名ブランチ用の PR が既に存在します。

PR:
${EX_PR_URL}
"
  fi
  exit 0
fi

if git ls-remote --heads origin "refs/heads/${BRANCH}" | grep -q .; then
  log "skip: リモートにブランチ ${BRANCH} が既にあります（PR なし）"
  try_create_label "near-growth-agent-failed" "D93F0B"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

同名ブランチ \`${BRANCH}\` がリモートに既に存在し、対応する PR を特定できませんでした。重複を避けるため中止しました。ブランチと PR を確認してください。
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

add_running_label

install_deps() {
  if [[ -f pnpm-lock.yaml ]]; then
    corepack enable
    pnpm install --frozen-lockfile
  elif [[ -f yarn.lock ]]; then
    yarn install --frozen-lockfile 2>/dev/null || yarn install --immutable 2>/dev/null || yarn install
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
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

Cursor Agent実行に失敗しました。

原因:
Cursor CLI（agent）を PATH 上に見つけられませんでした。

確認してください:
- CURSOR_API_KEY がGitHub Secretsに設定されているか
- Cursor CLIの利用権限があるか
- GitHub Actionsのpermissionsが足りているか
- npm run build がローカルで通るか
"
  fi
  exit 1
fi

{
  cat <<'PREAMBLE'
---
あなたはNEAR Growth Automationの実装Agentです。

ルール：
- 既存設計を壊さず、最小差分で実装してください
- mainへ直接pushしないでください
- secrets/env/APIキーをログ・コード・Issue・PR本文に出さないでください
- 既存のLINE返信、成長システム、タスク管理、スプレッドシート連携を壊さないでください
- DB migrationを追加した場合は ensureSchema のMIGRATION_FILES に含めてください
- TypeScriptの型エラーを残さないでください
- npm run build が通る状態にしてください
- 実装内容が曖昧な場合は破壊的変更を避け、安全なフォールバックを入れてください
- mainへのマージは行わず、PR作成までで止めてください
---

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
git commit -m "$COMMIT_MSG"

git push -u origin "$BRANCH"

ISSUE_URL="https://github.com/${REPO}/issues/${ISSUE_NUMBER}"
cat >"$PR_BODY_FILE" <<EOF
## NEAR Growth Automation PR

元Issue:
- #${ISSUE_NUMBER}

suggestion_id:
- ${SUGGESTION_LINE}

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
  --title "$PR_TITLE" \
  --body-file "$PR_BODY_FILE" 2>&1)"
PR_EC=$?
set -e
PR_URL="$(printf '%s\n' "$PR_RAW" | grep -E '^https://[^ ]+/pull/[0-9]+' | tail -n1 | tr -d '\r')"
if [[ "$PR_EC" -ne 0 ]] || [[ -z "$PR_URL" ]] || [[ "$PR_URL" != https://* ]]; then
  log "error: gh pr create failed"
  try_create_label "near-growth-agent-failed" "D93F0B"
  SAFE_TAIL="$(redact_snippet <<<"$PR_RAW" || true)"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

Cursor Agent実行に失敗しました。

原因:
PR の作成に失敗しました（gh pr create）。

サニタイズ済み出力:
\`\`\`
${SAFE_TAIL:-（なし）}
\`\`\`

確認してください:
- GitHub Actionsのpermissionsが足りているか
- 同名ブランチや Draft の競合がないか
"
  fi
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
