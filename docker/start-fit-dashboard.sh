#!/usr/bin/env bash
set -euo pipefail

fit-dashboard &
backend_pid=$!

cleanup() {
	kill "$backend_pid" 2>/dev/null || true
	nginx -s quit >/dev/null 2>&1 || true
}
trap cleanup TERM INT EXIT

nginx -g 'daemon off;' &
nginx_pid=$!

wait -n "$backend_pid" "$nginx_pid"
exit_code=$?

kill "$backend_pid" "$nginx_pid" 2>/dev/null || true
wait || true
exit "$exit_code"
