#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/artifacts/phase4-certification"

MODE="local"
CLEANUP=true

while [[ $# -gt 0 ]]; do
  case $1 in
    --spot)
      MODE="spot"
      shift
      ;;
    --local)
      MODE="local"
      shift
      ;;
    --no-cleanup)
      CLEANUP=false
      shift
      ;;
    *)
      echo "Usage: $0 [--local | --spot] [--no-cleanup]"
      exit 1
      ;;
  esac
done

mkdir -p "$ARTIFACT_DIR"

cleanup() {
  EXIT_CODE=$?
  echo ""
  echo "=== Running Certification Teardown (Exit: $EXIT_CODE) ==="
  if [ "$CLEANUP" = true ]; then
    if [ "$MODE" = "spot" ]; then
      "$SCRIPT_DIR/destroy-environment.sh" || true
    fi
  fi
  exit "$EXIT_CODE"
}

trap cleanup EXIT

echo "=========================================================="
echo "  OpsKnight Phase 4 Production Certification Suite        "
echo "  Mode: $MODE                                             "
echo "=========================================================="

GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "Git Commit SHA: $GIT_SHA"

if [ "$MODE" = "spot" ]; then
  echo "Step 1: Provisioning Spot Instance..."
  "$SCRIPT_DIR/create-environment.sh" "$GIT_SHA"
  INSTANCE_IP=$(terraform -chdir="$REPO_ROOT/infra/certification/terraform" output -raw public_ip)
  export CERTIFICATION_APP_URL="http://$INSTANCE_IP:3000"
  export CERTIFICATION_MAILPIT_URL="http://$INSTANCE_IP:8025"
  export CERTIFICATION_DEPLOYMENT_MODE="aws-spot"
else
  export CERTIFICATION_APP_URL="http://localhost:3000"
  export CERTIFICATION_MAILPIT_URL="http://localhost:8025"
  export CERTIFICATION_DEPLOYMENT_MODE="docker-compose"
fi

echo ""
echo "Step 2: Executing Phase 4 Certification Gates..."
export VITEST_USE_REAL_DB=1
export DATABASE_URL="${DATABASE_URL:-postgresql://opsknight:opsknight_secure_password_change_me@127.0.0.1:5432/opsknight_db}"

npx vitest run tests/certification/gate*.test.ts --reporter=default --reporter=junit --outputFile="$ARTIFACT_DIR/junit.xml"

echo ""
echo "Step 3: Compiling Auditable Certification Artifacts..."
npx ts-node --project tsconfig.script.json "$SCRIPT_DIR/generate-report.ts"

if [ -f "$ARTIFACT_DIR/summary.json" ]; then
  SCORE=$(jq -r '.score' "$ARTIFACT_DIR/summary.json")
  CERTIFIED=$(jq -r '.certified' "$ARTIFACT_DIR/summary.json")

  echo ""
  echo "=========================================================="
  echo "  PHASE 4 PRODUCTION CERTIFICATION RESULT                 "
  echo "=========================================================="
  echo "  Score:    $SCORE"
  echo "  Verdict:  $([ "$CERTIFIED" = "true" ] && echo "CERTIFIED FOR PRODUCTION" || echo "NOT CERTIFIED")"
  echo "  Report:   $ARTIFACT_DIR/report.html"
  echo "=========================================================="

  if [ "$CERTIFIED" != "true" ]; then
    echo "❌ Mandatory certification gate(s) failed."
    exit 1
  fi
fi

echo "✅ Phase 4 Production Certification PASSED."
