#!/usr/bin/env bash
# ChatGPT / Cursor 向け: Git 追跡ファイルのみを 1 ファイルに連結（確認用ダンプ）。
# package-lock.json・生成物・.env 系・秘密っぽい拡張子は含めない。
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
OUT="${1:-near_all_src.txt}"

# このパスは常にダンプから外す（生成物・巨大ロックファイル・未追跡想定）
should_exclude() {
  local f="$1"
  [[ -z "$f" ]] && return 0

  [[ "$f" == package-lock.json ]] && return 0

  case "$f" in
    near_all_src.txt | near_all_src*.txt | */near_all_src*.txt) return 0 ;;
  esac

  case "$f" in
    node_modules/* | */node_modules/* | dist/* | */dist/*) return 0 ;;
  esac

  # .env 系（.env / .env.* を除外。.environment などはマッチしないよう (\.|$) で限定）
  if [[ "$f" =~ (^|/)\.env(\.|$) ]]; then
    return 0
  fi

  # 秘密情報になりやすいファイル名（追跡されていても出さない）
  case "${f##*/}" in
    *.pem | *.p12 | *.key | id_rsa | id_rsa.pub | *.keystore | *.jks) return 0 ;;
  esac
  case "$f" in
    *credentials.json* | *secrets.json* | *service-account*.json | *service_account*.json) return 0 ;;
  esac

  return 1
}

collect_paths() {
  # 明示ルート（追跡されているものだけ git が返す）
  git ls-files \
    Dockerfile \
    .gitignore \
    package.json \
    tsconfig.json \
    render.yaml \
    railway.json \
    README.md \
    2>/dev/null || true

  git ls-files 'docs/**' 'src/db/migrations/**' '.github/**' 'scripts/**' 'prompts/**' 'src/**' 2>/dev/null || true
}

TMP="$(mktemp "${TMPDIR:-/tmp}/near-all-src.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

: >"$TMP"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  should_exclude "$f" && continue
  printf '%s\n' "$f"
done < <(collect_paths | sort -u) >>"$TMP"

: >"$OUT"

GEN_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
FILE_COUNT="$(wc -l <"$TMP" | tr -d ' ')"

{
  printf '%s\n' "# NEAR source dump (git-tracked paths only, excluding package-lock and secrets)"
  printf '%s\n' "# Repository: ${REPO}"
  printf '%s\n' "# Generated (UTC): ${GEN_TS}"
  printf '%s\n' "# File count: ${FILE_COUNT}"
  printf '%s\n' "#"
  printf '%s\n' "# --- included paths (${FILE_COUNT}) ---"
  while IFS= read -r f; do
    printf '%s\n' "# ${f}"
  done <"$TMP"
  printf '%s\n' "# --- end of path list ---"
  printf '\n'
} >>"$OUT"

append_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  printf '%s\n' "=== ./${f} ===" >>"$OUT"
  cat -- "$f" >>"$OUT"
  printf '\n' >>"$OUT"
}

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  append_file "$f"
done <"$TMP"

LINE_COUNT="$(wc -l <"$OUT" | tr -d ' ')"
SECTION_COUNT="$(grep -c '^=== ' "$OUT" || true)"

printf '\n'
printf 'Wrote %s (%s lines, %s file sections)\n' "$OUT" "$LINE_COUNT" "$SECTION_COUNT"
printf 'Included file count: %s\n' "$FILE_COUNT"
printf '%s\n' '-- paths --'
cat "$TMP"
printf '%s\n' '-- end --'

if [[ "$SECTION_COUNT" -ne "$FILE_COUNT" ]]; then
  echo "warning: section count (${SECTION_COUNT}) != file list count (${FILE_COUNT})" >&2
fi
