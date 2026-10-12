#!/usr/bin/env bash
# Usage: scripts/smoke.sh https://n8n.example.com [webhook-path]
# Checks the deployed instance end to end (cold start included) and prints timings.
set -u
BASE="${1:?usage: smoke.sh https://your-domain [webhook-path]}"; BASE="${BASE%/}"
WH="${2:-}"
t() { curl -s -o /dev/null -w "%{http_code} %{time_total}s" --max-time 300 "$@"; }
echo "1. readiness (may include a cold start):   $(t "$BASE/healthz/readiness")"
echo "2. readiness again (warm):                 $(t "$BASE/healthz/readiness")"
echo "3. editor HTML:                            $(t "$BASE/")"
echo "4. REST settings:                          $(t "$BASE/rest/settings")"
if [ -n "$WH" ]; then
  echo "5. production webhook /webhook/$WH:        $(t -X POST "$BASE/webhook/$WH" -H 'content-type: application/json' -d '{"smoke":true}')"
fi
echo "Expected: all 200. First call can take 10-60s on a cold start."
