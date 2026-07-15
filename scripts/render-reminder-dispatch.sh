#!/bin/sh
# Render Cron Job から NEAR Web のリマインド dispatch を叩く（スリープ復帰 + 送信）。
set -eu

BASE="${NEAR_PUBLIC_URL:-${RENDER_EXTERNAL_URL:-}}"
if [ -z "$BASE" ]; then
  echo "NEAR_PUBLIC_URL or RENDER_EXTERNAL_URL is required" >&2
  exit 1
fi

URL="${BASE%/}/internal/reminders/dispatch"

if [ -n "${CRON_SECRET:-}" ]; then
  curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" "$URL"
else
  curl -fsS -X POST "$URL"
fi

echo ""
echo "reminder dispatch triggered OK"

# 兄弟サービスの keep-alive（Render 無料プランのコールドスリープで LINE Webhook が
# タイムアウト→無返信になるのを防ぐ）。失敗しても cron 自体は成功扱い。
# VELIORA_WAKE_URLS: カンマまたは空白区切りの /health URL 一覧
if [ -n "${VELIORA_WAKE_URLS:-}" ]; then
  for wake_url in $(printf '%s' "$VELIORA_WAKE_URLS" | tr ',' ' '); do
    [ -z "$wake_url" ] && continue
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 25 "$wake_url" || echo "ERR")
    echo "wake ${wake_url}: ${code}"
  done
fi
