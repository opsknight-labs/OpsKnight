---
order: 4
title: User Recovery CLI
description: Create or reactivate a local user directly in PostgreSQL when normal OpsKnight administration is unavailable.
---

# User Recovery CLI

The bundled `scripts/OpsKnight.mjs` command directly creates or updates a local database user. It is primarily a break-glass recovery tool, not a general OpsKnight API client.

Use the web UI for normal work:

- first administrator: `/setup`;
- additional users: **Users → Add/Invite User**;
- user roles/status: **Users**;
- self-service password: **Settings → Security**;
- normal production authentication: local login or configured OIDC.

## Safety boundary

The CLI requires direct `DATABASE_URL` access and bypasses the application's normal invitation and administration workflow. `--update` sets the user to `ACTIVE`, replaces name, role, and password, and clears invitation/deactivation timestamps.

It does not revoke existing sessions or write the same audit event as the UI password-change workflow. After break-glass use, review the user, revoke sessions through the supported admin path where required, review audit/system logs, and rotate exposed credentials.

Passwords supplied as command-line arguments can appear in shell history, terminal logs, CI output, and local process listings. Run only in a controlled terminal, disable/clean history according to your operating policy, and replace the temporary password immediately through a safer interactive workflow.

## Requirements

- Node.js 20 when running from a source checkout.
- The v1.4 application dependencies installed.
- `DATABASE_URL` in the process environment or repository `.env`.
- Network/database permission to read and write the OpsKnight PostgreSQL database.
- A backup or recovery point before an emergency update when database state is uncertain.

## Command

The repository exposes the script as either `ops` or case-sensitive `OpsKnight`:

```bash
npm run ops -- --help
```

Do not use `npm run opsknight`; that npm script is not defined in v1.4.

## Options

| Option                |     Required      | Behavior                                                                          |
| --------------------- | :---------------: | --------------------------------------------------------------------------------- |
| `--user NAME`         |        Yes        | Trims and stores the display name.                                                |
| `--email EMAIL`       |        Yes        | Trims and lowercases the unique email.                                            |
| `--password PASSWORD` |        Yes        | Hashes the supplied local password.                                               |
| `--role ROLE`         |        No         | `user`, `responder`, or `admin`; defaults to `user`. Values are case-insensitive. |
| `--update`            | For existing user | Permits replacement/reactivation of a user with the same email.                   |
| `--help` / `--h`      |        No         | Prints usage.                                                                     |

Unknown options are parsed but ignored by the current script; treat that as a limitation, not validation. Verify the exact command before execution.

## Create a recovery administrator

```bash
npm run ops -- \
  --user "Recovery Admin" \
  --email "recovery-admin@example.com" \
  --password "TEMPORARY_UNIQUE_PASSWORD" \
  --role admin
```

Expected output:

```text
Created user recovery-admin@example.com.
```

If the email already exists, the command fails and instructs you to use `--update`; it does not silently overwrite the user.

## Reactivate or replace an existing local user

```bash
npm run ops -- \
  --user "Recovery Admin" \
  --email "recovery-admin@example.com" \
  --password "NEW_TEMPORARY_UNIQUE_PASSWORD" \
  --role admin \
  --update
```

Expected output:

```text
Updated user recovery-admin@example.com.
```

This operation activates a disabled/invited account and changes its role. Confirm that this is the intended identity before using `--update`.

## Docker Compose

The standard application container is `opsknight-app` in Compose and `opsknight_app` as its explicit container name. Prefer the service name:

```bash
docker compose exec opsknight-app \
  npm run ops -- \
  --user "Recovery Admin" \
  --email "recovery-admin@example.com" \
  --password "TEMPORARY_UNIQUE_PASSWORD" \
  --role admin
```

## Kubernetes

Run against one application pod so it receives the same database configuration:

```bash
kubectl -n opsknight exec deploy/opsknight-app -- \
  npm run ops -- \
  --user "Recovery Admin" \
  --email "recovery-admin@example.com" \
  --password "TEMPORARY_UNIQUE_PASSWORD" \
  --role admin
```

If your image or deployment name differs, inspect the actual workload. A minimal custom runtime image may omit npm or the source script; use a controlled one-off container with the same application version and database secret instead of modifying a running container.

## Verify and close the recovery

1. Sign in through the normal public HTTPS origin.
2. Confirm the user's name, email, application role, and Active status.
3. Confirm the user can perform only the intended recovery task.
4. Change the temporary password through **Settings → Security** so sessions are revoked by the normal workflow.
5. Remove or demote the recovery administrator if it is no longer needed.
6. Review audit/system logs and record the break-glass event externally.
7. Clear terminal/history/CI artifacts that could contain the temporary password.

## Troubleshooting

| Error                      | Check                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL is required` | Set it in the process environment or a readable repository `.env`.                                                |
| `User already exists`      | Verify the identity, then use `--update` only if replacement/reactivation is intended.                            |
| `Invalid role`             | Use `user`, `responder`, or `admin`.                                                                              |
| Database connection error  | Host/DNS, TLS options, credentials, firewall, and database readiness.                                             |
| `npm run ops` missing      | Confirm the container/source checkout is OpsKnight v1.4 and includes `package.json` plus `scripts/OpsKnight.mjs`. |
| Login still fails          | Public URL/auth configuration, account email, OIDC-vs-local identity, and session cookies.                        |

## Related topics

- [Users](../core-concepts/users)
- [API keys](./README#create-an-api-key)
- [Authentication](../administration/authentication)
- [Troubleshooting](../troubleshooting)
