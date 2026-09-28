#!/usr/bin/env bash
# OpsKnight 2-Hour Dual Soak Test: Docker Compose (Split + PgBouncer) & Kind HA Cluster
set -uo pipefail

DURATION_SECONDS="${SOAK_DURATION_SECONDS:-7200}" # Default 2 hours (7200s)
INTERVAL_SECONDS="${SOAK_INTERVAL_SECONDS:-60}"   # Sample every 60s
LOG_DIR="${SOAK_LOG_DIR:-./artifacts/soak-test}"
COMPOSE_PORT=33000
KIND_PORT=30080
export OPSKNIGHT_IMAGE="${OPSKNIGHT_IMAGE:-opsknight-local:test}"
export OPSKNIGHT_PULL_POLICY="${OPSKNIGHT_PULL_POLICY:-never}"

mkdir -p "$LOG_DIR"
METRICS_FILE="$LOG_DIR/metrics.csv"
SUMMARY_FILE="$LOG_DIR/soak_summary.md"
COMPOSE_LOG="$LOG_DIR/compose_events.log"
KIND_LOG="$LOG_DIR/kind_events.log"

echo "timestamp,elapsed_sec,compose_http_code,compose_latency_ms,compose_running_roles,compose_db_conns,kind_http_code,kind_latency_ms,kind_running_pods,kind_restarts" > "$METRICS_FILE"

echo "================================================================="
echo "Starting OpsKnight 2-Hour Soak Test"
echo "Duration: ${DURATION_SECONDS}s (~$((DURATION_SECONDS / 3600)) hours)"
echo "Sampling Interval: ${INTERVAL_SECONDS}s"
echo "Compose Endpoint: http://127.0.0.1:${COMPOSE_PORT}"
echo "Kind Endpoint:    http://127.0.0.1:${KIND_PORT}"
echo "Output Directory: $LOG_DIR"
echo "================================================================="

START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_SECONDS))

compose_samples=0
compose_successes=0
compose_total_latency=0
compose_max_latency=0

kind_samples=0
kind_successes=0
kind_total_latency=0
kind_max_latency=0
kind_initial_restarts=0

# Count initial Kind restarts
if command -v kubectl >/dev/null 2>&1; then
  kind_initial_restarts=$(kubectl get pods -n opsknight --no-headers 2>/dev/null | awk '{sum+=$4} END {print sum+0}')
fi

iteration=0
while [ "$(date +%s)" -lt "$END_TIME" ]; do
  iteration=$((iteration + 1))
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TIME))
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # -------------------------------------------------------------
  # 1. Docker Compose Metrics
  # -------------------------------------------------------------
  comp_start=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
  comp_res=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${COMPOSE_PORT}/api/health?mode=readiness" 2>/dev/null || echo "000")
  comp_end=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
  comp_latency=$(( (comp_end - comp_start) / 1000000 ))
  [ "$comp_latency" -lt 0 ] && comp_latency=0

  compose_samples=$((compose_samples + 1))
  if [ "$comp_res" = "200" ]; then
    compose_successes=$((compose_successes + 1))
    compose_total_latency=$((compose_total_latency + comp_latency))
    [ "$comp_latency" -gt "$compose_max_latency" ] && compose_max_latency=$comp_latency
  fi

  # Compose running roles count
  comp_roles_running=$(docker compose -f docker-compose.yml -f docker-compose.split.yml -f docker-compose.pgbouncer.yml ps --format '{{.State}}' 2>/dev/null | grep -c "running" || echo "0")

  # Compose DB connections
  comp_db_conns=$(docker exec opsknight-split-runtime-deployment-opsknight-db-1 psql -U opsknight -d opsknight_db -t -A -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null || echo "0")

  # -------------------------------------------------------------
  # 2. Kind Kubernetes Cluster Metrics
  # -------------------------------------------------------------
  kind_start=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
  kind_res=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${KIND_PORT}/api/health?mode=readiness" 2>/dev/null || echo "000")
  kind_end=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
  kind_latency=$(( (kind_end - kind_start) / 1000000 ))
  [ "$kind_latency" -lt 0 ] && kind_latency=0

  kind_samples=$((kind_samples + 1))
  if [ "$kind_res" = "200" ]; then
    kind_successes=$((kind_successes + 1))
    kind_total_latency=$((kind_total_latency + kind_latency))
    [ "$kind_latency" -gt "$kind_max_latency" ] && kind_max_latency=$kind_latency
  fi

  # Kind running pods count and delta restarts
  kind_pods_running="0"
  kind_curr_restarts="0"
  if command -v kubectl >/dev/null 2>&1; then
    kind_pods_running=$(kubectl get pods -n opsknight --no-headers 2>/dev/null | grep -c "Running" || echo "0")
    total_restarts=$(kubectl get pods -n opsknight --no-headers 2>/dev/null | awk '{sum+=$4} END {print sum+0}')
    kind_curr_restarts=$((total_restarts - kind_initial_restarts))
    [ "$kind_curr_restarts" -lt 0 ] && kind_curr_restarts=0
  fi

  # Append to CSV
  echo "$TIMESTAMP,$ELAPSED,$comp_res,$comp_latency,$comp_roles_running,$comp_db_conns,$kind_res,$kind_latency,$kind_pods_running,$kind_curr_restarts" >> "$METRICS_FILE"

  # Console status update every sample
  printf "[%s | %04ds / %04ds] Compose: HTTP %s (%dms, roles: %s, db_conns: %s) | Kind: HTTP %s (%dms, pods: %s, new_restarts: %d)\n" \
    "$(date +%T)" "$ELAPSED" "$DURATION_SECONDS" \
    "$comp_res" "$comp_latency" "$comp_roles_running" "$comp_db_conns" \
    "$kind_res" "$kind_latency" "$kind_pods_running" "$kind_curr_restarts"

  # Write periodic summary artifact every 10 iterations
  if [ $((iteration % 10)) -eq 0 ] || [ $((ELAPSED + INTERVAL_SECONDS)) -ge "$DURATION_SECONDS" ]; then
    comp_avail="0.0"
    comp_avg_lat="0"
    if [ "$compose_samples" -gt 0 ]; then
      comp_avail=$(awk "BEGIN {printf \"%.2f\", ($compose_successes / $compose_samples) * 100}")
      [ "$compose_successes" -gt 0 ] && comp_avg_lat=$((compose_total_latency / compose_successes))
    fi

    kind_avail="0.0"
    kind_avg_lat="0"
    if [ "$kind_samples" -gt 0 ]; then
      kind_avail=$(awk "BEGIN {printf \"%.2f\", ($kind_successes / $kind_samples) * 100}")
      [ "$kind_successes" -gt 0 ] && kind_avg_lat=$((kind_total_latency / kind_successes))
    fi

    cat <<EOF > "$SUMMARY_FILE"
# OpsKnight 2-Hour Soak Test Status Report

- **Elapsed Time**: ${ELAPSED}s / ${DURATION_SECONDS}s ($((ELAPSED * 100 / DURATION_SECONDS))%)
- **Last Sample Time**: $TIMESTAMP
- **Sampling Interval**: ${INTERVAL_SECONDS}s

## Docker Compose Split Stack (Local Port ${COMPOSE_PORT})
| Metric | Value |
| --- | --- |
| Total Probes | $compose_samples |
| Successful Probes | $compose_successes |
| Availability | ${comp_avail}% |
| Average Latency | ${comp_avg_lat} ms |
| Peak Latency | ${compose_max_latency} ms |
| Running Roles | ${comp_roles_running} / 7 (web, scheduler, general, critical, bulk, projector, pgbouncer) |
| Active Database Connections | ${comp_db_conns} |

## Kind Kubernetes HA Stack (Local Port ${KIND_PORT})
| Metric | Value |
| --- | --- |
| Total Probes | $kind_samples |
| Successful Probes | $kind_successes |
| Availability | ${kind_avail}% |
| Average Latency | ${kind_avg_lat} ms |
| Peak Latency | ${kind_max_latency} ms |
| Running Pods | ${kind_pods_running} |
| Unexpected Restarts During Soak | ${kind_curr_restarts} |
EOF
  fi

  sleep "$INTERVAL_SECONDS"
done

echo "================================================================="
echo "Soak Test Completed Successfully!"
echo "Report generated at: $SUMMARY_FILE"
echo "Raw CSV metrics:     $METRICS_FILE"
echo "================================================================="
