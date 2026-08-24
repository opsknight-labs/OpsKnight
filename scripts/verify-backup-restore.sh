#!/usr/bin/env bash
set -euo pipefail

backup_file="${1:-}"
if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  echo "Usage: scripts/verify-backup-restore.sh /absolute/path/to/backup.sql[.gz]|backup.dump"
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for an isolated restore drill."
  exit 2
fi

container_name="opsknight-restore-drill-$RANDOM-$RANDOM"
database_name="opsknight_restore_drill"
database_user="opsknight_restore"
database_password="restore-drill-only"
started_at="$(date +%s)"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$container_name" \
  -e POSTGRES_DB="$database_name" \
  -e POSTGRES_USER="$database_user" \
  -e POSTGRES_PASSWORD="$database_password" \
  postgres:15-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U "$database_user" -d "$database_name" >/dev/null

docker cp "$backup_file" "$container_name:/tmp/opsknight-backup"
case "$backup_file" in
  *.sql.gz)
    docker exec "$container_name" sh -c \
      "gunzip -c /tmp/opsknight-backup | psql -v ON_ERROR_STOP=1 -U '$database_user' -d '$database_name'" >/dev/null
    ;;
  *.sql)
    docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U "$database_user" \
      -d "$database_name" -f /tmp/opsknight-backup >/dev/null
    ;;
  *)
    docker exec "$container_name" pg_restore --exit-on-error --no-owner --no-privileges \
      -U "$database_user" -d "$database_name" /tmp/opsknight-backup >/dev/null
    ;;
esac

docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database_name" \
  -c 'SELECT COUNT(*) AS migration_count FROM "_prisma_migrations";' \
  -c 'SELECT COUNT(*) AS incident_count FROM "Incident";' \
  -c 'SELECT COUNT(*) AS user_count FROM "User";'

finished_at="$(date +%s)"
echo "Restore drill passed in $((finished_at - started_at)) seconds using an isolated PostgreSQL container."
