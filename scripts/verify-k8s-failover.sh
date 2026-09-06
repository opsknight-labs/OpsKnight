#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_OPSKNIGHT_CHAOS:-}" != "delete-one-app-pod" ]]; then
  echo "Refusing to disrupt a cluster. Set CONFIRM_OPSKNIGHT_CHAOS=delete-one-app-pod explicitly."
  exit 2
fi

namespace="${OPSKNIGHT_NAMESPACE:-opsknight}"
selector="${OPSKNIGHT_POD_SELECTOR:-app.kubernetes.io/name=opsknight}"
health_url="${OPSKNIGHT_HEALTH_URL:-}"
if [[ -z "$health_url" ]]; then
  echo "OPSKNIGHT_HEALTH_URL must point to the externally reachable readiness endpoint."
  exit 2
fi

ready_before="$(kubectl -n "$namespace" get pods -l "$selector" --field-selector=status.phase=Running -o name | wc -l | tr -d ' ')"
if (( ready_before < 2 )); then
  echo "At least two running OpsKnight pods are required; found $ready_before."
  exit 1
fi

target="$(kubectl -n "$namespace" get pods -l "$selector" -o jsonpath='{.items[0].metadata.name}')"
echo "Deleting pod $namespace/$target and probing $health_url"
kubectl -n "$namespace" delete pod "$target" --wait=false

failures=0
for _ in $(seq 1 60); do
  if ! curl --fail --silent --show-error --max-time 3 "$health_url" >/dev/null; then
    failures=$((failures + 1))
  fi
  sleep 1
done

kubectl -n "$namespace" wait --for=condition=Ready pod -l "$selector" --timeout=5m
if (( failures > 1 )); then
  echo "Failover drill failed: $failures readiness requests failed."
  exit 1
fi
echo "Failover drill passed with $failures failed readiness request(s)."
