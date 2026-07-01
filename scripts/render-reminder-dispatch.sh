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
