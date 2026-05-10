#!/usr/bin/env bash
# NEAR Growth Automation (v2.2): Issue をトリガーに Cursor CLI で実装し、PR まで作成する（スモーク分岐あり）。
#
# 実装チェックリスト（監査用・処理順）:
# [x] near-growth-smoke-test … README.md のみ更新・Agent なしで build→PR 経路を検証
# [x] CURSOR_API_KEY 未設定 → 通常フローのみ失敗（スモークではキー不要）
# [x] secrets をログ/Issue/PR に出さない（echo しない・redact_stream / redact_snippet でマスク）
# [x] Issue 本文取得（gh issue view body → BODY_FILE）
# [x] suggestion_id: 数値 → suggestion-{n} / 英数字・ハイフン → slug 化 / 無し → issue-{issue_number}
# [x] 重複防止（紐づき open PR・同名 head の PR・リモートのみブランチ）
# [x] 作業ブランチ作成（git checkout -B … origin/${DEFAULT_BRANCH} ※ main へは push しない）
# [x] near-growth-agent-running 付与（重複 PR チェック通過直後・本文取得より前）
# [x] Cursor CLI インストール（curl …）※実行バイナリは公式どおり `agent`
# [x] Headless 実行: agent（workspace 付き → workspace なし → -p のみでフォールバック）
# [x] npm run build
# [x] 差分なし → Issue コメントして exit 0（EXIT トラップで running 除去）
# [x] 差分あり → commit / push 作業ブランチ / gh pr create / Issue に PR URL / near-growth-pr-created
# [x] 成功・失敗・差分なしいずれも EXIT トラップで near-growth-agent-running を除去（付与後のみ）
#
# - CURSOR_API_KEY はログに出さない
# - gh は GH_TOKEN（github.token）を使用
#
# 再テスト手順（同一 Issue でやり直すとき）:
# 1. near-growth-pr-created / near-growth-agent-running / near-growth-agent-failed を必要に応じて外す
# 2. ワークフローは issues.labeled のみのため、ラベルを一度外して付け直す（通常: near-growth/cursor-agent、スモーク: near-growth-smoke-test）
#
# スモークテスト手順（PR 経路のみ・Agent なし）:
# - Issue に near-growth-smoke-test を付ける → Actions → README 更新 → PR → Issue に PR URL

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
SMOKE_MODE=0
AGENT_PATH_STR=""
AGENT_HELP_STATUS_STR=""
AGENT_TRIES_DESC=""
IMPL_BULLET=""
PR_SUCCESS_BLURB=""

log() {
  echo "[near-growth] $*" >&2
}

# stdin をマスク（末尾トリムなし）。長いログは呼び出し側で tail する。
redact_stream() {
  sed -E \
    -e 's/(CURSOR_API_KEY|GITHUB_TOKEN|GH_TOKEN|OPENAI_API_KEY|SECRET|PASSWORD|BEARER)\s*[=:]\s*\S+/[REDACTED]/Ig' \
    -e 's/sk-[a-zA-Z0-9]{10,}/[REDACTED]/g' \
    -e 's/ghp_[a-zA-Z0-9]{10,}/[REDACTED]/g' \
    -e 's/gho_[a-zA-Z0-9]{10,}/[REDACTED]/g' \
    -e 's/postgresql:\/\/[^ ]+/[REDACTED_DB]/Ig'
}

redact_snippet() {
  redact_stream | tail -n 40
}

log_agent_sanitized_tail() {
  local file="$1"
  local n="${2:-80}"
  log "Cursor Agent sanitized log tail (last ${n} lines):"
  tail -n "$n" "$file" 2>/dev/null | redact_stream >&2 || true
}

log_agent_preflight() {
  export CURSOR_API_KEY="${CURSOR_API_KEY:-}"
  if [[ -n "${CURSOR_API_KEY:-}" ]]; then
    log "CURSOR_API_KEY is set: yes"
  else
    log "CURSOR_API_KEY is set: no"
  fi
  log "pwd: $(pwd)"
  log "git branch --show-current: $(git branch --show-current 2>/dev/null || echo '(none)')"

  AGENT_PATH_STR="$(command -v agent 2>/dev/null || true)"
  log "agent path: ${AGENT_PATH_STR:-'(not found)'}"

  if [[ -n "$AGENT_PATH_STR" ]]; then
    log "agent --version:"
    agent --version 2>&1 | head -n 20 >&2 || log "(agent --version failed)"

    log "agent --help (first 50 lines):"
    local help_out
    help_out="$(agent --help 2>&1 | head -n 50 || true)"
    if [[ -n "$help_out" ]]; then
      AGENT_HELP_STATUS_STR="yes ($(printf '%s\n' "$help_out" | wc -l | tr -d ' ') lines)"
      printf '%s\n' "$help_out" >&2
    else
      AGENT_HELP_STATUS_STR="empty or failed"
      log "(agent --help produced no output)"
    fi
  else
    AGENT_HELP_STATUS_STR="skipped (agent not in PATH)"
  fi
}

# 戻り値 0=成功。ログは AGENT_LOG に追記。
# プロンプトは必ず `--` の後に渡す（本文が `---` で始まると CLI がオプション誤認するため）。
run_agent_with_fallback() {
  export CURSOR_API_KEY="${CURSOR_API_KEY:-}"
  local prompt
  prompt="$(cat "$PROMPT_FILE")"

  : >"$AGENT_LOG"
  AGENT_TRIES_DESC=$'試行したコマンド（順・プロンプト本文は省略）:\n'

  log "try agent: (-p --force --trust --workspace … -- <prompt>)"
  AGENT_TRIES_DESC+='1) agent -p --force --trust --workspace <WORKDIR> -- <prompt>'$'\n'
  if agent -p --force --trust --workspace "$WORKDIR" -- "$prompt" >"$AGENT_LOG" 2>&1; then
    return 0
  fi

  log "try agent: (-p --force --trust … -- <prompt>)"
  AGENT_TRIES_DESC+='2) agent -p --force --trust -- <prompt>'$'\n'
  echo "" >>"$AGENT_LOG"
  echo "=== fallback: without --workspace ===" >>"$AGENT_LOG"
  if agent -p --force --trust -- "$prompt" >>"$AGENT_LOG" 2>&1; then
    return 0
  fi

  log "try agent: (minimal: -p -- <prompt>)"
  AGENT_TRIES_DESC+='3) agent -p -- <prompt>'$'\n'
  echo "" >>"$AGENT_LOG"
  echo "=== fallback: minimal -p ===" >>"$AGENT_LOG"
  if agent -p -- "$prompt" >>"$AGENT_LOG" 2>&1; then
    return 0
  fi

  return 1
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

# 本文から suggestion トークンを 1 つ抽出（空の場合あり）。改行直後の ## suggestion_id 優先。
extract_suggestion_token_from_body() {
  local body_file="$1"
  local line sid

  if grep -qE '^## suggestion_id[[:space:]]*$' "$body_file"; then
    line="$(grep -A1 -E '^## suggestion_id[[:space:]]*$' "$body_file" | tail -n1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [[ -n "$line" ]]; then
      printf '%s' "$line"
      return 0
    fi
  fi

  sid="$(grep -oiE 'suggestion[[:space:]]*#[[:space:]]*[0-9]{1,12}\>' "$body_file" | head -1 | grep -oE '[0-9]{1,12}$' || true)"
  if [[ "$sid" =~ ^[0-9]+$ ]]; then
    printf '%s' "$sid"
    return 0
  fi

  line="$(grep -oiE 'suggestion_id[[:space:]]*=[[:space:]]*[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}' "$body_file" | head -1 | sed -E 's/^[^=]*=[[:space:]]*//')"
  if [[ -n "$line" ]]; then
    printf '%s' "$line"
    return 0
  fi

  line="$(grep -oiE 'suggestion_id[D:=[:space:]]+[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}' "$body_file" | head -1 | sed -E 's/^[^:=D]*[D:=[:space:]]+//')"
  if [[ -n "$line" ]]; then
    printf '%s' "$line"
    return 0
  fi

  sid="$(grep -oiE 'suggestion_id[[:space:]]*=[[:space:]]*[0-9]{1,12}' "$body_file" | grep -oE '[0-9]{1,12}$' | head -1 || true)"
  if [[ "$sid" =~ ^[0-9]+$ ]]; then
    printf '%s' "$sid"
    return 0
  fi

  sid="$(grep -oiE 'suggestion_id[D:=[:space:]]+[0-9]{1,12}' "$body_file" | grep -oE '[0-9]{1,12}$' | head -1 || true)"
  if [[ "$sid" =~ ^[0-9]+$ ]]; then
    printf '%s' "$sid"
    return 0
  fi

  printf ''
}

# 英数字・ハイフン以外を除去し Git ブランチセグメント向けに短縮（空なら空）。
slugify_suggestion_token() {
  local raw="$1"
  local s
  [[ -z "$raw" ]] && return 0
  s="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | sed -E 's/[^a-z0-9-]+/-/g' | sed -E 's/^-+|-+$//g' | sed -E 's/-{2,}/-/g')"
  if [[ ${#s} -gt 60 ]]; then
    s="${s:0:60}"
    s="${s%-}"
  fi
  printf '%s' "$s"
}

# refs/heads/{branch} を GitHub REST 用にエンコード（スラッシュのみ %2F）。
encode_git_refs_branch_for_api() {
  printf '%s' "$1" | sed 's|/|%2F|g'
}

# リモートに branch があり PR が無く先端が default と同一なら削除。0=削除した 1=しなかった。
try_delete_remote_branch_if_orphan_same_tip() {
  local branch="$1"
  local enc remote_sha base_sha pr_n

  if ! git ls-remote --heads origin "refs/heads/${branch}" | grep -q .; then
    return 1
  fi

  pr_n="$(gh pr list -R "$REPO" --head "$branch" --state all --json number -q 'length' 2>/dev/null || echo 999)"
  if [[ "${pr_n:-999}" != "0" ]]; then
    return 1
  fi

  remote_sha="$(git ls-remote origin "refs/heads/${branch}" | awk '{print $1; exit}')"
  base_sha="$(git rev-parse "origin/${DEFAULT_BRANCH}" 2>/dev/null || true)"
  if [[ -z "$remote_sha" || -z "$base_sha" || "$remote_sha" != "$base_sha" ]]; then
    return 1
  fi

  enc="$(encode_git_refs_branch_for_api "$branch")"
  if gh api --method DELETE "repos/${REPO}/git/refs/heads/${enc}" >/dev/null 2>&1; then
    log "removed orphan remote branch ${branch} (tip matches origin/${DEFAULT_BRANCH})"
    return 0
  fi
  return 1
}

# near-growth-smoke-test: README.md に指定文言を追加（無ければ # NEAR テンプレで作成）。再実行時はマーカー行で差分を確実に出す。
apply_smoke_readme_patch() {
  local sentence='GitHub Issue自動作成に対応しました。'
  if [[ ! -f README.md ]]; then
    printf '# NEAR\n\n%s\n' "$sentence" >README.md
    log "smoke: created README.md"
    return 0
  fi
  if ! grep -Fq "$sentence" README.md; then
    printf '\n%s\n' "$sentence" >>README.md
    log "smoke: appended sentence to README.md"
    return 0
  fi
  printf '\n<!-- near-growth-smoke-issue-%s %s -->\n' "$ISSUE_NUMBER" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>README.md
  log "smoke: appended marker (sentence already in README.md)"
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

if has_label "near-growth-smoke-test"; then
  SMOKE_MODE=1
  try_create_label "near-growth-smoke-test" "C5DEF5"
elif ! has_label "near-growth" || ! has_label "cursor-agent"; then
  log "skip: near-growth-smoke-test が無い場合は near-growth と cursor-agent の両方が必要です"
  exit 0
fi

# 本文・ブランチ名より前でもよい＝同一 Issue に紐づく Growth PR があれば即終了
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

# labeled 再発火抑止: workflow の if と合わせ、本文取得より前に running を付与
add_running_label

BODY_FILE="$(mktemp)"
PROMPT_FILE="$(mktemp)"
PR_BODY_FILE="$(mktemp)"

gh issue view "$ISSUE_NUMBER" -R "$REPO" --json body -q .body >"$BODY_FILE"

if [[ "$SMOKE_MODE" == 1 ]]; then
  BRANCH="near-growth/smoke-issue-${ISSUE_NUMBER}"
  SUGGESTION_LINE="smoke-test（near-growth-smoke-test・README のみ・Cursor Agent なし）"
  PR_TITLE="chore(growth): smoke test issue #${ISSUE_NUMBER}"
  COMMIT_MSG="chore(growth): smoke test (issue #${ISSUE_NUMBER})"
  IMPL_BULLET='- NEAR Growth Automation **スモークテスト**（ラベル **near-growth-smoke-test**）。README.md のみ更新。Cursor Agent / Cursor CLI は未使用。'
  PR_SUCCESS_BLURB='スモークテスト（near-growth-smoke-test・README のみ・Agent なし）で PR を作成しました。'
else
  SUGGESTION_TOKEN="$(extract_suggestion_token_from_body "$BODY_FILE")"
  if [[ "$SUGGESTION_TOKEN" =~ ^[0-9]+$ ]]; then
    BRANCH="near-growth/suggestion-${SUGGESTION_TOKEN}"
    SUGGESTION_LINE="${SUGGESTION_TOKEN}（数値）"
    PR_TITLE="feat(growth): suggestion #${SUGGESTION_TOKEN}"
    COMMIT_MSG="feat(growth): suggestion #${SUGGESTION_TOKEN} (issue #${ISSUE_NUMBER})"
  else
    SUGGESTION_SLUG="$(slugify_suggestion_token "$SUGGESTION_TOKEN")"
    if [[ -n "$SUGGESTION_SLUG" ]]; then
      BRANCH="near-growth/suggestion-${SUGGESTION_SLUG}"
      SUGGESTION_LINE="${SUGGESTION_TOKEN}（slug: ${SUGGESTION_SLUG}）"
      PR_TITLE="feat(growth): suggestion ${SUGGESTION_SLUG}"
      COMMIT_MSG="feat(growth): suggestion ${SUGGESTION_SLUG} (issue #${ISSUE_NUMBER})"
    else
      BRANCH="near-growth/issue-${ISSUE_NUMBER}"
      SUGGESTION_LINE="（suggestion_id なし） issue-${ISSUE_NUMBER} をブランチ名に使用"
      PR_TITLE="feat(growth): issue #${ISSUE_NUMBER}"
      COMMIT_MSG="feat(growth): issue #${ISSUE_NUMBER} (suggestion_id なし)"
    fi
  fi
  IMPL_BULLET='- Cursor Agent が Issue の実装指示に基づきコードを更新しました（差分を参照してください）。'
  PR_SUCCESS_BLURB="Cursor Agentによる実装PRを作成しました。"
fi

DEFAULT_BRANCH="$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name)"
git fetch origin "$DEFAULT_BRANCH"

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
  if try_delete_remote_branch_if_orphan_same_tip "$BRANCH"; then
    log "cleared orphan remote ${BRANCH} (same tip as default, no PR)"
  else
    log "skip: リモートにブランチ ${BRANCH} が既にあります（PR なし）"
    try_create_label "near-growth-agent-failed" "D93F0B"
    if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
      gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

同名ブランチ \`${BRANCH}\` がリモートに既に存在し、対応する PR を特定できませんでした。重複を避けるため中止しました。ブランチと PR を確認してください。

先端がデフォルトブランチと同一の空の追跡ブランチなら自動削除されます。それ以外は GitHub の Branches から削除するか、\`git push origin --delete ${BRANCH}\` で削除してから再実行してください。
"
    fi
    exit 0
  fi
fi

if [[ "$SMOKE_MODE" != 1 ]] && [[ -z "${CURSOR_API_KEY:-}" ]]; then
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

git checkout -B "$BRANCH" "origin/${DEFAULT_BRANCH}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

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

if [[ "$SMOKE_MODE" == 1 ]]; then
  log "smoke test mode: patch README.md (skip Cursor CLI / agent)"
  apply_smoke_readme_patch
else
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
- Issue に記載された変更対象ファイルは必ず編集してください（ファイル名が明示されていれば、そのファイルに差分を出してください）
- 実装要件にファイル名がある場合、そのファイルに必ず変更を加えてください。差分なしで終了しないでください
- 不要な大規模リファクタリングはしないでください
- git push / gh pr create は自動化スクリプト側が行うため、あなた自身で git push や PR 作成コマンドを実行しないでください

【実装対象（Issue 本文）】

PREAMBLE
    cat "$BODY_FILE"
  } >"$PROMPT_FILE"

  AGENT_LOG="$(mktemp)"
  log_agent_preflight

  log "run Cursor Agent (headless)"
  set +e
  run_agent_with_fallback
  AGENT_EXIT=$?
  set -e
  if [[ "$AGENT_EXIT" -ne 0 ]]; then
    log "Cursor Agent: all invocation patterns failed (last exit code ${AGENT_EXIT})"
    log_agent_sanitized_tail "$AGENT_LOG" 80
    try_create_label "near-growth-agent-failed" "D93F0B"
    SAFE_TAIL="$(tail -n 80 "$AGENT_LOG" | redact_stream || true)"
    if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
      gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

Cursor Agent実行に失敗しました。

原因:
Cursor CLI（agent）がすべての実行パターンで異常終了しました（フォールバック後も失敗）。

診断:
- agent path: \`${AGENT_PATH_STR:-unknown}\`
- agent --help 取得: ${AGENT_HELP_STATUS_STR:-unknown}

${AGENT_TRIES_DESC}

サニタイズ済みログ末尾（最大80行）:
\`\`\`
${SAFE_TAIL:-（なし）}
\`\`\`

確認してください:
- CURSOR_API_KEY がGitHub Secretsに設定されているか
- Cursor CLIの利用権限・サブスクリプションがあるか
- GitHub Actionsのpermissionsが足りているか
- npm run build がローカルで通るか（ここまで未到達の場合は agent 側の失敗です）

※再実行する場合: Issue から \`near-growth-agent-running\` と \`near-growth-agent-failed\` を外し、\`cursor-agent\` ラベルを付け直してください。
"
    fi
    exit 1
  fi
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
  ORPHAN_TAIL=""
  if git ls-remote --heads origin "refs/heads/${BRANCH}" | grep -q .; then
    if try_delete_remote_branch_if_orphan_same_tip "$BRANCH"; then
      ORPHAN_TAIL=$'\n\n※リモートに同名ブランチがありましたが、先端がデフォルトブランチと同一かつ PR が無かったため、空の追跡ブランチとして削除しました。'
    else
      PR_ORPHAN_N="$(gh pr list -R "$REPO" --head "$BRANCH" --state all --json number -q 'length' 2>/dev/null || echo 1)"
      if [[ "${PR_ORPHAN_N:-1}" == "0" ]]; then
        ORPHAN_TAIL="$(printf '\n\n※リモートブランチ `%s` が残っています（PR なし）。再実行で衝突する場合は GitHub の Branches から削除するか、`git push origin --delete %s` で削除してください。' "$BRANCH" "$BRANCH")"
      fi
    fi
  fi
  if ! issue_comment_bodies | grep -Fq "$MARKER_NO_DIFF"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_NO_DIFF}

実装の結果、リポジトリに差分はありませんでした（PR は作成していません）。

考えられる原因:
- Issue本文が曖昧で、変更対象ファイルを特定できなかった
- Agentが計画のみで終了した
- 指定された変更が既に反映済みだった

対策:
- 変更対象ファイルを明示してください
- 「必ず README.md を編集してください」のように具体化してください
- suggestion_id は数字のみを推奨します
${ORPHAN_TAIL}
"
  fi
  exit 0
fi

git add -A
git commit -m "$COMMIT_MSG"

if [[ "$BRANCH" == "$DEFAULT_BRANCH" ]]; then
  log "error: 作業ブランチがデフォルトブランチと同一です。main 等への直接 push は行いません。"
  try_create_label "near-growth-agent-failed" "D93F0B"
  if ! issue_comment_bodies | grep -Fq "$MARKER_FAIL"; then
    gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "${MARKER_FAIL}

ブランチ名がデフォルトブランチと同一になる異常を検出したため、push を中止しました。

確認してください:
- suggestion_id 抽出やブランチ命名ロジックが意図どおりか
"
  fi
  exit 1
fi

git push -u origin "$BRANCH"

ISSUE_URL="https://github.com/${REPO}/issues/${ISSUE_NUMBER}"
# unquoted heredoc は ** やバッククォートでグロブ／コマンド置換が起きうるため、変数はすべて printf で追記する
{
  cat <<'NEAR_GROWTH_PR_HEAD'
## NEAR Growth Automation PR

元Issue:
NEAR_GROWTH_PR_HEAD
  printf -- '- #%s\n\n' "${ISSUE_NUMBER}"
  printf '%s\n' "suggestion_id:"
  printf -- '- %s\n\n' "${SUGGESTION_LINE}"
  printf '%s\n\n' "## 実装内容"
  printf '%s\n\n' "${IMPL_BULLET}"
  cat <<'NEAR_GROWTH_PR_TAIL'
## 確認事項
- [ ] npm run build 通過
- [ ] main直接pushなし
- [ ] secrets出力なし
- [ ] 既存LINE応答への影響確認
- [ ] DB migrationがある場合 ensureSchema に追加済み

## 管理者確認
LINEで「反映して」と言われるまではmainにマージしない。

NEAR_GROWTH_PR_TAIL
  printf '%s\n' "（元Issue: ${ISSUE_URL}）"
} >"$PR_BODY_FILE"

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
PR の作成に失敗しました（gh pr create）。スモークテストの場合も同じです。

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

${PR_SUCCESS_BLURB}

PR:
${PR_URL}

管理者確認後、NEAR側で「反映して」に進めます。
"
fi

try_create_label "near-growth-pr-created" "0E8A16"
gh issue edit "$ISSUE_NUMBER" -R "$REPO" --add-label "near-growth-pr-created" 2>/dev/null || true

log "done: ${PR_URL}"
exit 0
