---
order: 10
title: Troubleshooting
description: Diagnose Compose, Kubernetes, database, migration, authentication, scheduler, incident, integration, and notification failures safely.
---

# Troubleshooting

Start at the earliest failed boundary and preserve evidence before changing configuration. A healthy login page does not prove PostgreSQL writes, scheduled work, inbound integrations, or responder notifications function.

## First five checks

1. Record the OpsKnight image/version, deployment method, failure time/time zone, affected service/user/integration, and the last known successful test.
2. Check liveness and database readiness separately:

   ```bash
   curl --fail https://ops.example.com/api/health
   curl --fail 'https://ops.example.com/api/health?mode=readiness'
   ```

3. Check application startup/runtime logs and PostgreSQL/platform health for the same window.
4. Reproduce with one controlled synthetic workflow; do not page production responders repeatedly.
5. Change one layer at a time and retain before/after evidence.

Redact passwords, session/API/integration keys, signature secrets, authenticated webhook URLs, provider payloads, cookies, and personal data before sharing output.

## Docker Compose

### The UI never loads or `docker compose up` exits

```bash
docker compose ps
docker compose logs --tail=200 opsknight-app
docker compose logs --tail=200 opsknight-db
curl --fail 'http://localhost:3000/api/health?mode=readiness'
```

Check in this order:

- `opsknight-db` reaches `healthy` and has disk/volume capacity;
- database credentials in `.env` agree with the initialized volume;
- `NEXTAUTH_SECRET` is present and `ENCRYPTION_KEY` is 64 hexadecimal characters;
- application startup logs show the migration result; and
- `APP_PORT`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` match the browser origin.

`docker compose config` is useful for detecting interpolation problems, but its output can contain rendered secrets. Do not paste it into a ticket without redaction.

### PostgreSQL connection is refused

Inside the Compose application network, PostgreSQL is `opsknight-db:5432`, not `localhost`. On the development host, a published PostgreSQL port normally uses `localhost`.

```bash
docker compose exec -T opsknight-db \
  pg_isready -U "${POSTGRES_USER:-opsknight}" -d "${POSTGRES_DB:-opsknight_db}"
```

If the database volume was initialized with an older password, changing `.env` does not rewrite the database role automatically. Restore the original credential or follow a planned PostgreSQL credential-rotation procedure.

### Port 3000 is already in use

```bash
lsof -i :3000
```

Set `APP_PORT=3001` and use `http://localhost:3001` for both application URL settings, then recreate the app container. Do not change the container's internal port 3000 in the standard Compose file.

### You think the database must be reset

Stop. `docker compose down -v` deletes the named PostgreSQL volume. It is not a routine repair command. Confirm the exact Compose project/volume, preserve a backup, and use it only for a deliberately disposable environment. For real data, follow [Backup and restore](./deployment/backup-restore).

## Kubernetes

The Kustomize Deployment is normally `opsknight-app`; the Helm Deployment is normally `opsknight`. Inspect actual names before copying commands.

```bash
kubectl -n opsknight get deploy,pods,svc,ingress,pvc,hpa,pdb
kubectl -n opsknight get events --sort-by=.lastTimestamp
kubectl -n opsknight describe pod POD_NAME
kubectl -n opsknight logs POD_NAME --all-containers --tail=200
```

For intermittent failures, compare pod image digests, restart counts, environment/Secret sources, node/zone placement, and the health response `instanceId`. Different `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, URL, or database settings across replicas cause request-dependent failures.

If readiness fails, check PostgreSQL DNS/network/TLS/credentials and migration state. If only real-time updates disconnect, check ingress buffering and idle/read timeouts for SSE. If scheduled work stalls, keep internal cron enabled on at least one healthy replica and inspect scheduler state/logs.

See [Kubernetes deployment](./deployment/kubernetes) for the complete topology checklist.

## Database and migrations

### The app runs but queries fail after an upgrade

The container can start after three failed migration attempts. Inspect startup logs instead of assuming a running/Ready process proves schema success.

From a matching source checkout or application container:

```bash
npm run prisma:validate
npm run prisma:health
npx prisma migrate status
```

Do not use `prisma db push`, edit `_prisma_migrations`, or mark a migration applied merely to clear an error. Capture the exact Prisma code/message and follow [Database migrations](./deployment/database-migrations). Preserve a recovery point before any repair.

### `@prisma/client` is not initialized in a custom build

Reproduce the repository build order: install the lockfile, copy the schema/migrations, run `npx prisma generate`, build, and include the generated Prisma client/runtime in the final image. The published Dockerfile already does this. Rebuild a pinned image; do not install or generate ad hoc inside a running production container.

### Pages are slow or time out

Correlate application request/query latency with PostgreSQL connections, pool wait, slow queries, locks, CPU, memory, storage latency, and table/index growth. The Admin **Settings → Performance Monitoring** page shows selected SLA-query observations; it is not a complete database/APM system.

```sql
SHOW max_connections;
SELECT state, count(*)
FROM pg_stat_activity
GROUP BY state;
```

Do not blindly raise a per-process pool limit. Budget every replica plus migration, backup, monitoring, and administrative reserve, then load-test. See [Scalability and capacity planning](./core-concepts/scalability).

## Authentication

### Login loops or the session disappears

- The browser origin must exactly match `NEXTAUTH_URL`, including HTTPS and port.
- `NEXT_PUBLIC_APP_URL` should normally match it.
- The trusted proxy must forward the original host and scheme.
- All replicas must use the same stable `NEXTAUTH_SECRET`.
- Secure-cookie selection follows whether `NEXTAUTH_URL` begins with `https://`.

Replacing `NEXTAUTH_SECRET` invalidates existing sessions and does not fix an origin mismatch. Restore the intended stable secret, clear only the affected site's cookies, and retry in a private browser window.

### A valid local account cannot sign in

Confirm normalized email, account status, and whether the user is a local-password or OIDC-only identity. After five failures for one email/client-IP key, the process-local login guard applies a progressive lockout. Wait for the displayed lockout, stop repeated retries, and investigate the client IP forwarded by the trusted proxy.

Use **Forgot password** or an Admin-generated reset link for normal recovery. The bundled CLI creates/updates a local user directly; it does not provide `user:list` or `user:reset-password` subcommands. Use it only through the [User recovery CLI](./api/cli) runbook.

Changing `ENCRYPTION_KEY` does not repair a bcrypt local password. It can make stored OIDC/provider credentials unreadable, which is a separate failure.

### OIDC sign-in fails

Check:

1. the exact callback `https://YOUR_ORIGIN/api/auth/callback/oidc` at the IdP;
2. HTTPS issuer discovery from the application network;
3. configured client ID/secret and `ENCRYPTION_KEY` decryption;
4. `openid email profile` plus any mapping claims in the actual token/profile;
5. email, `email_verified`, allowed-domain, provisioning, and first-link approval rules; and
6. issuer-plus-subject identity conflicts or role-mapping order.

Retain a working local Admin while testing. See [Authentication](./administration/authentication) and [OIDC setup](./security/oidc-setup).

## Incident creation and correlation

### An inbound alert does not create an incident

Capture the sender's HTTP status/body and check:

- the integration exists, is enabled, and belongs to the intended service;
- the integration ID and key are both current;
- any configured signature uses the exact provider header/algorithm/raw bytes;
- the payload passes that provider's schema and maps to `trigger` rather than acknowledge/resolve;
- HTTP 429 is retried only after `Retry-After`; and
- **Event Logs**, system logs, and the service integration show the request.

Provider-native routes normally return HTTP 202 when accepted. Acceptance proves normalization/processing returned, not external notification delivery. See [Inbound webhook reference](./integrations/inbound-webhook-reference).

### Duplicate incidents appear

Compare the target service and normalized deduplication key. The same condition must send a stable provider identifier/key; timestamps and random IDs create new correlation groups. Confirm the earlier incident state and the provider-specific fallback behavior.

### Recovery does not resolve the incident

Confirm the recovery maps to `resolve` and produces the same service/key as the trigger. Some providers use event/pipeline/deployment IDs rather than a branch or monitor display name. Open the provider guide and compare both raw deliveries. See [Event correlation](./architecture/deduplication-engine).

## Escalation and scheduled work

### A policy does not page or advance

Verify the incident is actionable (`OPEN`), the service has the intended policy, the next step exists, and its user/team/schedule target resolves to an active eligible recipient. Assignment alone is not acknowledgment; acknowledgment/resolution completes escalation.

Inspect scheduler logs for start/tick/lock/job errors. Read-only database checks can confirm coordination and backlog:

```sql
SELECT id, "lastRunAt", "lastSuccessAt", "nextRunAt", "lockedBy", "lockedAt", "lastError"
FROM cron_scheduler_state;

SELECT status, type, count(*), min("scheduledAt") AS oldest_scheduled
FROM "BackgroundJob"
GROUP BY status, type
ORDER BY status, type;
```

Do not clear the scheduler lock manually as a first response. The scheduler heartbeats active ownership and can reclaim a stale lock after its timeout. Identify a live owner, database latency, a long-running tick, and replica churn first.

## Notification delivery

### An incident exists but no external notification arrives

Trace the complete route:

1. the service policy reached the intended user/team/schedule;
2. the recipient is active, eligible for team notification when applicable, and has the required email/phone/push subscription;
3. the user/service notification selections permit the channel;
4. **Settings → Notification Providers** shows one enabled provider with valid credentials;
5. the provider's test succeeds; and
6. **Settings → Notification History**, system logs, and provider logs agree.

In-app notification creation and external delivery are separate. User channel selection uses fallback behavior in several flows; it is not guaranteed fan-out to every enabled channel.

### Email, SMS, WhatsApp, or push provider fails

- Email: verify enabled provider, sender/domain authorization, recipient, and provider activity/logs.
- Twilio SMS/WhatsApp: verify SID/token, sender/from value, E.164 recipient, trial restrictions, and WhatsApp enablement/template/window rules.
- AWS SNS/SES: verify region, least-privilege credentials, sender/domain state, sandbox restrictions, and provider response.
- Web Push: require HTTPS (except localhost development), enabled VAPID provider, browser permission/subscription, and service-worker registration.

The published image includes declared notification dependencies. If a custom pruned image reports a missing package, compare its build with the repository Dockerfile/lockfile and rebuild; do not run `npm install` inside the live container.

Provider calls can be rejected, time out, exhaust retries, or encounter a process-local open circuit. Restoring configuration does not automatically replay every failed notification; verify with a fresh controlled incident.

## Webhook response guide

| Status | Interpretation and next action                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------- |
| 400    | Missing/invalid ID/key/body/schema on standardized routes; correct the request, do not blindly retry. |
| 401    | Missing/invalid credential or configured signature on applicable routes; correct secrets/headers.     |
| 403    | Disabled integration or authorization failure on applicable routes.                                   |
| 404    | Integration/resource not found; verify current ID and destination.                                    |
| 429    | Rate limit reached; honor `Retry-After`, add jitter, and inspect retry/noise volume.                  |
| 5xx    | Unexpected processing/dependency failure; retry an idempotent event with bounds and preserve logs.    |

Authentication status codes differ on a few legacy/provider routes. Inspect the response JSON and provider guide instead of assuming one status universally identifies the cause.

## Debug logging

Set `LOG_FORMAT=json` for collection and raise `LOG_LEVEL=debug` only for a bounded diagnostic window. Debug context can contain sensitive provider and operational data.

For containers, change the deployment environment and recreate/restart through the normal release owner, then collect stdout/stderr:

```bash
docker compose logs -f opsknight-app
kubectl -n opsknight logs deployment/opsknight-app --all-containers -f
```

Every replica has its own in-app System Logs buffer. Export platform logs durably and include instance/pod identity when correlating. Return to the normal log level after diagnosis.

## Encryption-key failures

If stored credentials suddenly fail to decrypt:

1. compare the active `ENCRYPTION_KEY` source/version across every replica;
2. restore the exact original key from the protected backup when it was changed accidentally;
3. verify database and key belong to the same installation/recovery point; and
4. if the key is irretrievably lost, configure a new valid key and re-enter each affected OIDC, Slack, Jira, and notification-provider credential.

Do not rotate upstream credentials only in OpsKnight after suspected exposure; revoke/rotate them at the provider too. See [Encryption](./security/encryption).

## Ask for help

Search [GitHub issues](https://github.com/opsknight-labs/OpsKnight/issues) and [discussions](https://github.com/opsknight-labs/OpsKnight/discussions). A useful report includes:

- OpsKnight version/image digest and deployment method;
- browser, Node.js (source builds), PostgreSQL, and relevant platform versions;
- precise timestamps/time zone and affected workflow;
- minimal reproduction and expected/actual result;
- health/readiness status and sanitized logs; and
- whether a fresh controlled synthetic test succeeds.

Never include credentials, complete authenticated URLs, cookies, raw customer alerts, or unreviewed database dumps.
