#!/usr/bin/env bash
# リポジトリの主要ソースを 1 ファイルに連結（確認用ダンプ）。既定出力 near_all_src.txt（.gitignore）。
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-near_all_src.txt}"
: >"$OUT"

append_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  printf '%s\n' "=== ./${f} ===" >>"$OUT"
  cat -- "$f" >>"$OUT"
  printf '\n' >>"$OUT"
}

# ルート設定ファイル（従来ダンプと同様の順）
for f in Dockerfile package-lock.json package.json render.yaml tsconfig.json railway.json; do
  append_file "$f"
done

while IFS= read -r f; do append_file "$f"; done < <(git ls-files 'prompts/**' | sort)
while IFS= read -r f; do append_file "$f"; done < <(git ls-files '.github/**' | sort)
while IFS= read -r f; do append_file "$f"; done < <(git ls-files 'scripts/**' | sort)
while IFS= read -r f; do
  [[ "$f" == *'/.DS_Store' ]] && continue
  append_file "$f"
done < <(git ls-files 'src/**' | sort)

wc -l <"$OUT" | tr -d ' '
echo "files -> $OUT"
