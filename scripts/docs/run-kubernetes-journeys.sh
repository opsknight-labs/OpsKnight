#!/usr/bin/env sh
set -eu

namespace=opsknight-docs
cleanup() {
  [ -z "${app_forward_pid:-}" ] || kill "$app_forward_pid" 2>/dev/null || true
  [ -z "${db_forward_pid:-}" ] || kill "$db_forward_pid" 2>/dev/null || true
  sh scripts/docs/cleanup-kubernetes.sh "$namespace"
}
trap cleanup EXIT INT TERM

kubectl apply -k tests/docs/environment/kubernetes
kubectl -n "$namespace" rollout status statefulset/postgres --timeout=180s
kubectl -n "$namespace" rollout status deployment/opsknight --timeout=480s
kubectl -n "$namespace" rollout status deployment/provider-mocks --timeout=180s
kubectl -n "$namespace" port-forward service/opsknight 3200:3000 >/tmp/opsknight-docs-app-forward.log 2>&1 &
app_forward_pid=$!
kubectl -n "$namespace" port-forward service/postgres 55432:5432 >/tmp/opsknight-docs-db-forward.log 2>&1 &
db_forward_pid=$!

DOCS_EXTERNAL_RUNTIME=true \
DOCS_BASE_URL=http://localhost:3200 \
DOCS_DATABASE_URL=postgresql://opsknight_docs:opsknight_docs@127.0.0.1:55432/opsknight_docs?schema=public \
npx playwright test -c playwright.docs.config.ts
