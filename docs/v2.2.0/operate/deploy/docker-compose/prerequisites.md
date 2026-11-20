---
title: Prepare a host for OpsKnight Compose
description: Validate the host, network, secrets, image, storage, and database requirements before starting OpsKnight with Compose.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Compose prerequisites, Docker host, secrets, image digest]
reader:
  status: READER_COMPLETE
  task: Prepare and validate a host for an OpsKnight Compose installation.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - env.example
    - deploy/compose/docker-compose.yml
    - deploy/scripts/validate-runtime-capacity.cjs
---

# Prepare a host for OpsKnight Compose

Complete this page before starting either integrated or split runtime.

## Prerequisites

You need a Linux host with Docker Engine, Compose v2, persistent local storage, outbound HTTPS, DNS for the public origin, and a TLS reverse proxy. Reserve host port `3000` for OpsKnight and, when using bundled PostgreSQL, loopback port `5432` unless you override them.

Verify the tools:

```sh
docker version
docker compose version
openssl version
```

Use an operator account that can manage Docker without exposing the socket to untrusted users.

## Prepare the configuration

From the repository revision matching the deployment assets:

```sh
cp env.example .env
chmod 600 .env
```

Generate independent stable secrets:

```sh
openssl rand -base64 32  # NEXTAUTH_SECRET
openssl rand -base64 32  # API_KEY_SECRET
openssl rand -hex 32     # ENCRYPTION_KEY
openssl rand -base64 32  # POSTGRES_PASSWORD
```

Put the values into `.env` without committing the file:

```dotenv
OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight@sha256:<tested-release-digest>
OPSKNIGHT_PULL_POLICY=always
NEXTAUTH_URL=https://opsknight.example.com
NEXT_PUBLIC_APP_URL=https://opsknight.example.com
NEXTAUTH_SECRET=<generated-value>
API_KEY_SECRET=<different-generated-value>
ENCRYPTION_KEY=<64-hex-character-value>
POSTGRES_USER=opsknight
POSTGRES_PASSWORD=<generated-value>
POSTGRES_DB=opsknight_db
POSTGRES_PORT=5432
APP_PORT=3000
```

Keep the three application secrets identical across every role and stable across restart, upgrade, and restore. Losing `ENCRYPTION_KEY` makes stored provider credentials unreadable.

## Install and validate the prerequisites

Confirm the ports are not already occupied and the filesystem holding Docker data has enough free space for the database, images, logs, and backup staging:

```sh
ss -lnt | grep -E ':(3000|5432)\b' || true
df -h
docker info --format '{{json .DriverStatus}}'
```

Allow outbound traffic to required notification, ChatOps, identity, issue-tracking, and webhook providers. Do not publish PostgreSQL to a public interface.

Validate the base Compose model:

```sh
docker compose -f deploy/compose/docker-compose.yml config --quiet
docker compose -f deploy/compose/docker-compose.yml config --images
```

The second command must show the exact approved digest, not `latest` or an unexpected compatibility image. Treat rendered configuration as sensitive because it can contain expanded secret values.

## Verify the host is ready

The host is ready when:

- Docker and Compose commands complete successfully;
- the selected public hostname resolves to the intended proxy;
- the exact image digest is available from the host's registry credentials;
- `.env` is mode `0600`, excluded from source control, and backed up in a secret manager;
- selected ports and persistent storage are available;
- database and provider egress paths are permitted.

Do not continue if `docker compose config --quiet` fails or the rendered image differs from the approved release.

## Production and security considerations

Restrict Docker administration, protect `.env`, retain stable secrets outside the host, and keep database backups outside the Compose volume. A named volume is persistence, not a backup. Terminate TLS before accepting user traffic.

## Troubleshooting

**Image pull is denied:** authenticate the host to the registry and confirm the digest exists for the host architecture.

**A port is already allocated:** stop the conflicting process or intentionally change `APP_PORT`/`POSTGRES_PORT`; do not expose PostgreSQL publicly to avoid the collision.

**Compose reports an unset variable:** populate it in `.env` and rerun `config --quiet`. Do not accept an empty secret substitution.

**The public hostname is not ready:** finish DNS and TLS setup before testing authentication or provider callbacks. Localhost success does not validate the production origin.

## Next steps

- [Install integrated runtime](./integrated)
- [Install split runtime](./split)
- [Use external PostgreSQL](./external-postgres)

