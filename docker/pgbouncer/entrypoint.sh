#!/bin/sh
set -eu

# OpsKnight PgBouncer Dynamic Entrypoint
# Generates runtime pgbouncer.ini and isolated authentication credentials.

WORK_DIR="/tmp/pgbouncer"
mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"

# Parse connection settings from explicit variables or OPSKNIGHT_DATABASE_URL
DB_HOST="${PGBOUNCER_DB_HOST:-}"
DB_PORT="${PGBOUNCER_DB_PORT:-}"
DB_NAME="${PGBOUNCER_DB_NAME:-}"
DB_USER="${PGBOUNCER_DB_USER:-}"
DB_PASS="${PGBOUNCER_DB_PASSWORD:-}"
TLS_SSLMODE="${PGBOUNCER_SERVER_TLS_SSLMODE:-}"
TLS_CA_FILE="${PGBOUNCER_SERVER_TLS_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}"

# If OPSKNIGHT_DATABASE_URL is set and explicit DB_HOST is not provided, parse the URL
if [ -z "$DB_HOST" ] && [ -n "${OPSKNIGHT_DATABASE_URL:-}" ]; then
  # Format: postgresql://[user[:password]@]host[:port][/dbname][?params]
  URL_WITHOUT_PROTO="${OPSKNIGHT_DATABASE_URL#*://}"
  PARAMS=""
  case "$URL_WITHOUT_PROTO" in
    *\?*)
      PARAMS="${URL_WITHOUT_PROTO#*\?}"
      URL_WITHOUT_PROTO="${URL_WITHOUT_PROTO%%\?*}"
      ;;
  esac

  case "$URL_WITHOUT_PROTO" in
    *@*)
      AUTH_PART="${URL_WITHOUT_PROTO%%@*}"
      HOST_DB_PART="${URL_WITHOUT_PROTO#*@}"
      if [ -z "$DB_USER" ]; then
        case "$AUTH_PART" in
          *:*) DB_USER="${AUTH_PART%%:*}"; DB_PASS="${AUTH_PART#*:}" ;;
          *) DB_USER="$AUTH_PART" ;;
        esac
      fi
      ;;
    *)
      HOST_DB_PART="$URL_WITHOUT_PROTO"
      ;;
  esac

  case "$HOST_DB_PART" in
    */*)
      HOST_PORT_PART="${HOST_DB_PART%%/*}"
      if [ -z "$DB_NAME" ]; then
        DB_NAME="${HOST_DB_PART#*/}"
      fi
      ;;
    *)
      HOST_PORT_PART="$HOST_DB_PART"
      ;;
  esac

  case "$HOST_PORT_PART" in
    *:*)
      DB_HOST="${HOST_PORT_PART%%:*}"
      if [ -z "$DB_PORT" ]; then
        DB_PORT="${HOST_PORT_PART#*:}"
      fi
      ;;
    *)
      DB_HOST="$HOST_PORT_PART"
      ;;
  esac

  # Extract sslmode if present in params
  if [ -z "$TLS_SSLMODE" ] && [ -n "$PARAMS" ]; then
    case "$PARAMS" in
      *sslmode=verify-full*) TLS_SSLMODE="verify-full" ;;
      *sslmode=verify-ca*)   TLS_SSLMODE="verify-ca" ;;
      *sslmode=require*)     TLS_SSLMODE="require" ;;
      *sslmode=prefer*)      TLS_SSLMODE="prefer" ;;
      *sslmode=disable*)     TLS_SSLMODE="disable" ;;
    esac
  fi
fi

# Fallback to local container defaults
DB_HOST="${DB_HOST:-${POSTGRES_HOST:-opsknight-db}}"
DB_PORT="${DB_PORT:-${POSTGRES_PORT:-5432}}"
DB_NAME="${DB_NAME:-${POSTGRES_DB:-opsknight_db}}"
DB_USER="${DB_USER:-${POSTGRES_USER:-opsknight}}"
DB_PASS="${DB_PASS:-${POSTGRES_PASSWORD:-opsknight_secure_password_change_me}}"

# Determine default TLS mode:
# If connecting to the bundled opsknight-db container, TLS is disabled by default.
# For external DB hosts, default to verify-full for production safety.
if [ -z "$TLS_SSLMODE" ]; then
  if [ "$DB_HOST" = "opsknight-db" ] || [ "$DB_HOST" = "127.0.0.1" ] || [ "$DB_HOST" = "localhost" ]; then
    TLS_SSLMODE="disable"
  else
    TLS_SSLMODE="verify-full"
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
