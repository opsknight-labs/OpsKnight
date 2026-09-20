#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TF_DIR="$REPO_ROOT/infra/certification/terraform"

echo "========================================================"
echo "  Provisioning Phase 4 Disposable EC2 Spot Environment  "
echo "========================================================"

cd "$TF_DIR"

GIT_COMMIT="${1:-$(git rev-parse HEAD 2>/dev/null || echo 'manual')}"
export TF_VAR_git_commit="$GIT_COMMIT"

echo "Initializing Terraform..."
terraform init -input=false

echo "Planning and applying Spot instance..."
terraform apply -input=false -auto-approve

INSTANCE_IP=$(terraform output -raw public_ip)
INSTANCE_ID=$(terraform output -raw instance_id)

echo ""
echo "✅ Spot Instance Provisioned:"
echo "   Instance ID: $INSTANCE_ID"
echo "   Public IP:   $INSTANCE_IP"
echo "   App URL:     http://$INSTANCE_IP:3000"
echo "   Mailpit URL: http://$INSTANCE_IP:8025"
echo ""

echo "Waiting for instance cloud-init to install Docker and initialize..."
MAX_ATTEMPTS=30
ATTEMPT=0
READY=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "ubuntu@$INSTANCE_IP" "docker --version && docker compose version" >/dev/null 2>&1; then
    READY=1
    break
  fi
  echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS: waiting for SSH & Docker..."
  sleep 10
done

if [ $READY -eq 1 ]; then
  echo "✅ Instance is ready for deployment."
else
  echo "❌ Timed out waiting for instance readiness."
  exit 1
fi
