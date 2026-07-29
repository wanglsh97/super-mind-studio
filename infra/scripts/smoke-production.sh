#!/usr/bin/env sh
set -eu

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1}}"
BASE_URL="${BASE_URL%/}"
SMOKE_MODEL_ID="${SMOKE_MODEL_ID:-qwen3.7-plus}"
SMOKE_USER_SESSION_TOKEN="${SMOKE_USER_SESSION_TOKEN:-}"

temp_dir="$(mktemp -d)"
anonymous_response="$temp_dir/anonymous-response.json"
thread_response="$temp_dir/thread-response.json"
run_response="$temp_dir/run-response.json"
event_transcript="$temp_dir/agent-events.log"
curl_config="$temp_dir/curl-config"

cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT INT TERM

curl --noproxy '*' --fail --silent --show-error --max-time 10 "$BASE_URL/health/live" >/dev/null
curl --noproxy '*' --fail --silent --show-error --max-time 10 "$BASE_URL/health/ready" >/dev/null
curl --noproxy '*' --fail --silent --show-error --max-time 10 "$BASE_URL/" >/dev/null

anonymous_status="$(curl --noproxy '*' --silent --show-error --max-time 10 \
  --output "$anonymous_response" \
  --write-out '%{http_code}' \
  --request POST "$BASE_URL/api/v1/agent/threads" \
  --header 'Content-Type: application/json' \
  --data "{\"model\":\"$SMOKE_MODEL_ID\"}")"
if [ "$anonymous_status" != '401' ]; then
  echo "未登录 Agent 门禁应返回 401，实际为 $anonymous_status。" >&2
  exit 1
fi

if [ -z "$SMOKE_USER_SESSION_TOKEN" ]; then
  echo 'production_smoke=ok health=ok agent_auth_gate=401 authenticated_agent=skipped'
  exit 0
fi

umask 077
printf 'cookie = "aigateway_user_session=%s"\n' "$SMOKE_USER_SESSION_TOKEN" >"$curl_config"

curl --noproxy '*' --fail --silent --show-error --max-time 15 \
  --config "$curl_config" \
  --request POST "$BASE_URL/api/v1/agent/threads" \
  --header 'Content-Type: application/json' \
  --data "{\"model\":\"$SMOKE_MODEL_ID\"}" \
  --output "$thread_response"
thread_id="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!v.id)process.exit(1);process.stdout.write(v.id)' "$thread_response")"

curl --noproxy '*' --fail --silent --show-error --max-time 15 \
  --config "$curl_config" \
  --request POST "$BASE_URL/api/v1/agent/threads/$thread_id/runs" \
  --header 'Content-Type: application/json' \
  --data '{"input":"生产部署 Agent 流式冒烟"}' \
  --output "$run_response"
run_id="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!v.id)process.exit(1);process.stdout.write(v.id)' "$run_response")"

curl --noproxy '*' --fail --no-buffer --silent --show-error --max-time 60 \
  --config "$curl_config" \
  "$BASE_URL/api/v1/agent/runs/$run_id/events" \
  --output "$event_transcript"

node -e '
const fs=require("fs");
const body=fs.readFileSync(process.argv[1],"utf8");
if(!body.includes("\"type\":\"text-delta\"")) throw new Error("Agent stream missing text-delta");
if(!body.includes("\"type\":\"run-terminal\"")) throw new Error("Agent stream missing run-terminal");
if(!body.includes("data: [DONE]")) throw new Error("Agent stream missing [DONE]");
' "$event_transcript"

printf 'production_smoke=ok health=ok agent_auth_gate=401 authenticated_agent=ok thread_id=%s run_id=%s\n' \
  "$thread_id" "$run_id"
