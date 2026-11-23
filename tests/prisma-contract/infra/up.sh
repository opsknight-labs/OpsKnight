#!/usr/bin/env bash
# Start the isolated Prisma contract databases and print the env exports they need.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TLS_DIR="$HERE/.tls"

if [ ! -f "$TLS_DIR/server.crt" ]; then
  mkdir -p "$TLS_DIR"
  # CA and server extensions satisfy strict verifiers (including macOS Security.framework).
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj '/CN=OpsKnight Contract CA' \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$TLS_DIR/ca.key" -out "$TLS_DIR/ca.crt" >/dev/null 2>&1
  # A second, unrelated CA proves that verification rejects untrusted chains.
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj '/CN=Untrusted CA' \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$TLS_DIR/other-ca.key" -out "$TLS_DIR/other-ca.crt" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' \
    -keyout "$TLS_DIR/server.key" -out "$TLS_DIR/server.csr" >/dev/null 2>&1
  printf 'subjectAltName=DNS:localhost,DNS:pg-tls\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n' > "$TLS_DIR/server.ext"
  openssl x509 -req -in "$TLS_DIR/server.csr" -CA "$TLS_DIR/ca.crt" -CAkey "$TLS_DIR/ca.key" \
    -CAcreateserial -CAserial "$TLS_DIR/ca.srl" -days 30 -extfile "$TLS_DIR/server.ext" -out "$TLS_DIR/server.crt" >/dev/null 2>&1
  chmod 644 "$TLS_DIR"/*.crt "$TLS_DIR/server.key"
fi

docker compose -f "$HERE/compose.yml" up -d --build --wait pg pg-tz pg-tls >&2
docker compose -f "$HERE/compose.yml" up -d --build pgbouncer pgbouncer-tz >&2
for _ in $(seq 1 30); do
  if docker compose -f "$HERE/compose.yml" exec -T pgbouncer pg_isready -h 127.0.0.1 -p 6432 >/dev/null 2>&1 &&
    docker compose -f "$HERE/compose.yml" exec -T pgbouncer-tz pg_isready -h 127.0.0.1 -p 6432 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

cat <<EOF
export CONTRACT_DATABASE_URL='postgresql://opsknight:contract_password@127.0.0.1:${PC_PG_PORT:-56501}/opsknight_contract?sslmode=disable'
export CONTRACT_TZ_DATABASE_URL='postgresql://opsknight:contract_password@127.0.0.1:${PC_PG_TZ_PORT:-56502}/opsknight_contract?sslmode=disable'
export CONTRACT_TLS_HOST_PORT='localhost:${PC_PG_TLS_PORT:-56503}'
export CONTRACT_TLS_CA_FILE='$TLS_DIR/ca.crt'
export CONTRACT_TLS_OTHER_CA_FILE='$TLS_DIR/other-ca.crt'
export CONTRACT_PGBOUNCER_URL='postgresql://opsknight:contract_password@127.0.0.1:${PC_PGBOUNCER_PORT:-56504}/opsknight_contract?sslmode=disable&pgbouncer=true'
export CONTRACT_PGBOUNCER_TZ_URL='postgresql://opsknight:contract_password@127.0.0.1:${PC_PGBOUNCER_TZ_PORT:-56505}/opsknight_contract?sslmode=disable&pgbouncer=true'
export CONTRACT_PGBOUNCER_ADMIN_URL='postgresql://pgbouncer_admin:admin_password@127.0.0.1:${PC_PGBOUNCER_PORT:-56504}/pgbouncer?sslmode=disable'
EOF
