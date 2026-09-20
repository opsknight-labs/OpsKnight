#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TF_DIR="$REPO_ROOT/infra/certification/terraform"

echo "========================================================"
echo "  Destroying Phase 4 Disposable EC2 Spot Environment    "
echo "========================================================"

if [ -d "$TF_DIR/.terraform" ]; then
  cd "$TF_DIR"
  terraform destroy -input=false -auto-approve
  echo "✅ Disposable certification infrastructure destroyed."
else
  echo "ℹ️  No Terraform state found; nothing to destroy."
fi
