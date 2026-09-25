#!/bin/sh
set -eu

# OpsKnight PgBouncer Dynamic Entrypoint
# Generates runtime pgbouncer.ini and isolated authentication credentials.

WORK_DIR="/tmp/pgbouncer"
mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"

DB_HOST="${PGBOUNCER_DB_HOST:-}"
TLS_CA_FILE="${PGBOUNCER_SERVER_TLS_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}"

# Fail-closed validation for external database without PgBouncer configuration
if [ -z "$DB_HOST" ]; then
  if [ -n "${OPSKNIGHT_DATABASE_URL:-}" ]; then
    echo "[FATAL] External PostgreSQL (OPSKNIGHT_DATABASE_URL) requires explicit structured PgBouncer parameters:" >&2
    echo "  - PGBOUNCER_DB_HOST" >&2
    echo "  - PGBOUNCER_DB_PORT (default: 5432)" >&2
    echo "  - PGBOUNCER_DB_NAME (default: \${POSTGRES_DB:-opsknight_db})" >&2
    echo "  - PGBOUNCER_DB_USER (default: \${POSTGRES_USER:-opsknight})" >&2
    echo "  - PGBOUNCER_DB_PASSWORD" >&2
    echo "  - PGBOUNCER_SERVER_TLS_SSLMODE (default: verify-full)" >&2
    exit 1
  fi

  # Automatic fallback for bundled PostgreSQL container
  DB_HOST="${POSTGRES_HOST:-opsknight-db}"
  DB_PORT="${PGBOUNCER_DB_PORT:-5432}"
  DB_NAME="${POSTGRES_DB:-opsknight_db}"
  DB_USER="${POSTGRES_USER:-opsknight}"
  DB_PASS="${POSTGRES_PASSWORD:-opsknight_secure_password_change_me}"
  TLS_SSLMODE="disable"
else
  # Explicit DB_HOST configured
  DB_PORT="${PGBOUNCER_DB_PORT:-5432}"
  DB_NAME="${PGBOUNCER_DB_NAME:-${POSTGRES_DB:-opsknight_db}}"
  DB_USER="${PGBOUNCER_DB_USER:-${POSTGRES_USER:-opsknight}}"
  DB_PASS="${PGBOUNCER_DB_PASSWORD:-${POSTGRES_PASSWORD:-}}"

  if [ "$DB_HOST" = "opsknight-db" ] || [ "$DB_HOST" = "localhost" ] || [ "$DB_HOST" = "127.0.0.1" ]; then
    TLS_SSLMODE="${PGBOUNCER_SERVER_TLS_SSLMODE:-disable}"
    DB_PASS="${DB_PASS:-opsknight_secure_password_change_me}"
  else
    # External host requires password and secure TLS by default
    TLS_SSLMODE="${PGBOUNCER_SERVER_TLS_SSLMODE:-verify-full}"
    if [ -z "$DB_PASS" ] || [ "$DB_PASS" = "opsknight_secure_password_change_me" ]; then
      echo "[FATAL] PGBOUNCER_DB_PASSWORD must be configured with the external database password." >&2
      exit 1
    fi
    if [ "$TLS_SSLMODE" = "verify-full" ] || [ "$TLS_SSLMODE" = "verify-ca" ]; then
      if [ ! -f "$TLS_CA_FILE" ]; then
        echo "[FATAL] TLS certificate authority file '$TLS_CA_FILE' not found." >&2
        exit 1
      fi
    fi
  fi
fi

# Handle authentication file (userlist.txt)
AUTH_FILE_PATH="${PGBOUNCER_AUTH_FILE:-}"
if [ -z "$AUTH_FILE_PATH" ] || [ ! -f "$AUTH_FILE_PATH" ]; then
  AUTH_FILE_PATH="$WORK_DIR/userlist.txt"
  # Write escaped user and password credentials
  CLEAN_USER=$(printf '%s' "$DB_USER" | sed 's/\\/\\\\/g; s/"/\\"/g')
  CLEAN_PASS=$(printf '%s' "$DB_PASS" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '"%s" "%s"\n' "$CLEAN_USER" "$CLEAN_PASS" > "$AUTH_FILE_PATH"

  # Optional dedicated admin user (isolated from application credentials)
  if [ -n "${PGBOUNCER_ADMIN_USER:-}" ] && [ -n "${PGBOUNCER_ADMIN_PASSWORD:-}" ]; then
    ADMIN_USER=$(printf '%s' "$PGBOUNCER_ADMIN_USER" | sed 's/\\/\\\\/g; s/"/\\"/g')
    ADMIN_PASS=$(printf '%s' "$PGBOUNCER_ADMIN_PASSWORD" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '"%s" "%s"\n' "$ADMIN_USER" "$ADMIN_PASS" >> "$AUTH_FILE_PATH"
  fi
  chmod 600 "$AUTH_FILE_PATH"
fi

# Pool tuning parameters
POOL_MODE="${PGBOUNCER_POOL_MODE:-transaction}"
MAX_CLIENT_CONN="${PGBOUNCER_MAX_CLIENT_CONN:-1000}"
DEFAULT_POOL_SIZE="${PGBOUNCER_DEFAULT_POOL_SIZE:-10}"
RESERVE_POOL_SIZE="${PGBOUNCER_RESERVE_POOL_SIZE:-5}"
MAX_PREPARED="${PGBOUNCER_MAX_PREPARED_STATEMENTS:-100}"

# Generate dynamic pgbouncer.ini
CONFIG_FILE="$WORK_DIR/pgbouncer.ini"
cat <<EOF > "$CONFIG_FILE"
[databases]
${DB_NAME} = host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME}
* = host=${DB_HOST} port=${DB_PORT}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = ${AUTH_FILE_PATH}
pool_mode = ${POOL_MODE}
max_client_conn = ${MAX_CLIENT_CONN}
default_pool_size = ${DEFAULT_POOL_SIZE}
reserve_pool_size = ${RESERVE_POOL_SIZE}
max_prepared_statements = ${MAX_PREPARED}
ignore_startup_parameters = extra_float_digits,search_path,statement_timeout
EOF

# Append TLS configuration if enabled
if [ "$TLS_SSLMODE" != "disable" ]; then
  cat <<EOF >> "$CONFIG_FILE"
server_tls_sslmode = ${TLS_SSLMODE}
EOF
  if [ -f "$TLS_CA_FILE" ]; then
    cat <<EOF >> "$CONFIG_FILE"
server_tls_ca_file = ${TLS_CA_FILE}
EOF
  fi
fi

# Append admin users ONLY if explicitly configured (never application users)
if [ -n "${PGBOUNCER_ADMIN_USER:-}" ]; then
  cat <<EOF >> "$CONFIG_FILE"
admin_users = ${PGBOUNCER_ADMIN_USER}
stats_users = ${PGBOUNCER_ADMIN_USER}
EOF
fi

chmod 600 "$CONFIG_FILE"

if [ $# -gt 0 ]; then
  exec "$@"
else
  exec /usr/bin/pgbouncer "$CONFIG_FILE"
fi
