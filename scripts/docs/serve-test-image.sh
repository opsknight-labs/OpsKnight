#!/usr/bin/env sh
set -eu

base_compose_file="deploy/compose/docker-compose.yml"
docs_compose_file="tests/docs/environment/compose.yaml"
project_name="opsknight-docs-v2-capture"
pull_policy="${DOCS_IMAGE_PULL_POLICY:-always}"

compose() {
  docker compose --project-name "$project_name" \
    -f "$base_compose_file" \
    -f "$docs_compose_file" \
    "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM
# The fixed project name and volume are documentation-only. Recreate both so a
# capture never inherits authentication throttles or records from an older run.
compose down --volumes --remove-orphans

# Release certification pins the locally built OpsKnight image and therefore
# starts Compose with --pull never. Fresh CI runners still need the database
# and mock-service images, so pull only those dependencies before enforcing
# the no-pull policy for the complete stack.
if [ "$pull_policy" = "never" ]; then
  compose pull opsknight-db mock-slack mock-teams mock-jira mock-smtp webhook-receiver
fi

compose up -d --pull "$pull_policy" --wait opsknight-app
compose logs --follow opsknight-app
