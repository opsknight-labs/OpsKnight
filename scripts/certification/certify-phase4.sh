#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/artifacts/phase4-certification"

mkdir -p "$ARTIFACT_DIR"
mkdir -p "$REPO_ROOT/reports"

echo "=========================================================="
echo "  OpsKnight Phase 4 Production Certification Suite        "
echo "=========================================================="

GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "Git Commit SHA: $GIT_SHA"

export CERTIFICATION_APP_URL="${CERTIFICATION_APP_URL:-http://localhost:3000}"
export CERTIFICATION_MAILPIT_URL="${CERTIFICATION_MAILPIT_URL:-http://localhost:8025}"
export CERTIFICATION_DEPLOYMENT_MODE="${CERTIFICATION_DEPLOYMENT_MODE:-ci}"
export VITEST_USE_REAL_DB=1
export DATABASE_URL="${DATABASE_URL:-postgresql://opsknight:opsknight_secure_password_change_me@127.0.0.1:5432/opsknight_db}"

echo ""
echo "Step 1: Executing Phase 4 Certification Gates..."
npx vitest run tests/certification/gate*.test.ts --no-file-parallelism --reporter=default --reporter=junit --outputFile="$ARTIFACT_DIR/junit.xml"

# Also copy junit report to reports/ for CI ingest if available
cp -f "$ARTIFACT_DIR/junit.xml" "$REPO_ROOT/reports/junit-certification.xml" 2>/dev/null || true

echo ""
echo "Step 2: Compiling Auditable Certification Artifacts..."
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
