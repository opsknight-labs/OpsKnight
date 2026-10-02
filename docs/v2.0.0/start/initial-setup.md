---
title: Complete the initial setup
description: Create the first administrator safely and establish the canonical public Application URL.
type: tutorial
product_area: deployment
audience: [operator, administrator]
keywords: [initial setup, first administrator, application URL, setup secret, bootstrap]
reader:
  status: READER_COMPLETE
  task: Complete a new OpsKnight installation without locking out the public hostname.
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [src/app/setup/page.tsx, src/app/setup/actions.ts, src/components/BootstrapSetupForm.tsx, src/lib/passwords.ts]
---

# Complete the initial setup

Use `/setup` once, after database migration and public readiness succeed. This workflow creates the first active administrator and saves the canonical Application URL. It is part of the deployment security boundary, not a cosmetic preference.

> **Before selecting Create administrator:** verify that **Application URL** is the browser-facing HTTPS origin. After initialization, requests for unknown application hosts are rejected with HTTP `421 Misdirected Request`.

## Before you begin

You need:

- an empty OpsKnight database with migrations complete;
- public DNS, TLS, proxy or ingress, and readiness working;
- `NEXTAUTH_URL` and normally `NEXT_PUBLIC_APP_URL` set to the same public origin;
- a 30-minute one-time bootstrap code generated after migration with `node scripts/create-bootstrap-code.mjs`; a configured `SETUP_SECRET` or legacy `BOOTSTRAP_SECRET` remains a compatibility alternative;
- a unique password of 15–64 Unicode characters and no more than 72 UTF-8 bytes. Default, common, or account-identifying passwords are rejected.

Only a database with no users can be initialized. Once any user exists, `/setup` redirects to `/login`. Concurrent attempts are serialized so they cannot create multiple first administrators.

## 1. Open setup through the public hostname

Open the public origin, not a container address, Service name, node IP, port-forward, or loopback address:

```text
https://opsknight.example.com/setup
```

Before initialization, OpsKnight deliberately permits `/setup` on the incoming host so a new installation cannot deadlock before its canonical host is saved.

## 2. Verify the detected Application URL

OpsKnight initially derives the field from the authoritative incoming request. With `TRUST_PROXY_HEADERS=true`, host selection uses the right-most `X-Forwarded-Host` and protocol selection uses the first `X-Forwarded-Proto`; the trusted edge should overwrite both with one authoritative public value. Otherwise OpsKnight uses the direct `Host` and request protocol. Environment values are fallbacks only when an origin cannot be derived.

The value must be an absolute HTTP or HTTPS origin. Use HTTPS in production and omit paths and a trailing slash.

| Value | Production assessment |
|---|---|
| `https://opsknight.example.com` | Correct when this is the public browser origin |
| `http://opsknight-app:3000` | Wrong: internal Compose/container address |
| `http://opsknight-web.opsknight.svc:3000` | Wrong: internal Kubernetes Service |
| `http://10.0.1.15:3000` | Wrong: internal node address |
| `http://localhost:3000` | Only appropriate for a local evaluation |

If the field is wrong, stop. Correct proxy forwarding and `TRUST_PROXY_HEADERS`, or enter the intended public origin manually. Do not create the administrator merely to test whether routing works.

## 3. Create the administrator

Generate the capability inside a running OpsKnight container or pod already
configured for the same database. Choose the command for your topology.

**Integrated Compose:**

```sh
docker compose -f deploy/compose/docker-compose.yml exec -T opsknight-app \
  node scripts/create-bootstrap-code.mjs
```

**Split Compose** (include the same override files used to start the stack):

```sh
docker compose -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml exec -T opsknight-web \
  node scripts/create-bootstrap-code.mjs
```

**Kustomize integrated or split:**

```sh
kubectl -n opsknight exec deploy/opsknight-app -- node scripts/create-bootstrap-code.mjs
# Split profile:
kubectl -n opsknight exec deploy/opsknight-web -- node scripts/create-bootstrap-code.mjs
```

**Helm:** find the Web deployment name emitted for your release, then execute
the same image-contained script. A release named `opsknight` normally uses the
following names:

```sh
# Integrated runtime
kubectl -n opsknight exec deploy/opsknight -- node scripts/create-bootstrap-code.mjs
# Split runtime
kubectl -n opsknight exec deploy/opsknight-web -- node scripts/create-bootstrap-code.mjs
```

Confirm the name first with `kubectl -n opsknight get deployment`; Helm release
and `fullnameOverride` values can change it.

**Docker Swarm:** run this on the node currently hosting a Web task. Replace
`opsknight` if you used another stack name. Swarm injects the database URL as a
secret file, so load it only into this one command:

```sh
WEB_CONTAINER=$(docker ps --quiet \
  --filter label=com.docker.swarm.service.name=opsknight_opsknight-web | head -n 1)
test -n "$WEB_CONTAINER"
docker exec "$WEB_CONTAINER" sh -c \
  'export DATABASE_URL="$(tr -d "\r\n" < "$DATABASE_URL_FILE")"; node scripts/create-bootstrap-code.mjs'
```

If no container is returned, use `docker service ps opsknight_opsknight-web` to
locate a running task and run the command on that node. Never copy a database
secret to the host merely to issue the code.

Treat the printed value like a password. Only its SHA-256 digest is stored, it expires after 30 minutes, only one can be active, and successful administrator creation consumes it atomically. Do not run the bare Node command on an unconfigured host: it needs the production dependencies and database environment supplied by the deployment. Enter the administrator name and email, the verified Application URL, the bootstrap code, and a strong unique password. Select **Create administrator** once. A configured environment setup secret is accepted for compatibility but is longer-lived and not preferred.

OpsKnight creates one `ACTIVE` user with the `ADMIN` role, stores the Application URL in `SystemSettings.appUrl`, and records bootstrap audit events. The browser then moves to sign-in.

## 4. Verify the saved origin

1. Sign in through the same public hostname.
2. Open **Settings → System → App URL**.
3. Confirm the saved value is the public HTTPS origin.
4. Select **Test link** and confirm the new page remains on that origin.
5. Create a test incident and inspect a generated notification link.

Also confirm an unrelated hostname returns `421`, while readiness and login succeed on the canonical hostname.

## If setup fails

- **Setup unavailable:** inspect database connectivity, migration state, and the request ID shown on the page.
- **Invalid or expired bootstrap code:** issue a code if none exists, or wait for the current live code to expire before issuing another. Do not log the code. For the compatibility path, compare the entered value with `SETUP_SECRET` or `BOOTSTRAP_SECRET`.
- **Password rejected:** use a longer unique passphrase that is not a default or identity value and remains within the byte limit.
- **Redirect to `/login`:** at least one user already exists. Use the normal administrator recovery process rather than trying to rerun bootstrap.
- **421 after creation:** follow [Recover from Misdirected Request](../troubleshooting/installation/misdirected-request).

## Next steps

- [Understand Application URL and host routing](../operate/deploy/application-url-and-host-routing)
- [Create the first service](./create-first-service)
- [Complete production acceptance](../operate/deploy/)
