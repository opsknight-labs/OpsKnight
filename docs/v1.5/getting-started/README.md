---
order: 1
title: Getting Started
description: Get from a fresh OpsKnight install to your first verified incident in about 10 minutes.
---

# Getting Started

This is the shortest path from a fresh OpsKnight installation to a working incident flow.

By the end, you will have:

- a running OpsKnight instance;
- an Admin account;
- one team, schedule, escalation policy, and service;
- one test incident that you acknowledge and resolve;
- an optional Events API test using a real integration key.

> Keep the first run simple. Notification providers, status pages, SSO, ChatOps, production monitoring integrations, and advanced deployment options can all be added after the core incident path works.

## Before you begin

You need Docker with Compose support, Git, OpenSSL, and a local shell. For Helm, Kustomize, or from-source installs, use [Installation](./installation).

## 1. Start OpsKnight

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight
cp env.example .env
```

Generate the two required secrets:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Add the generated values to `.env`:

```dotenv
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=PASTE_BASE64_OUTPUT
ENCRYPTION_KEY=PASTE_64_HEX_CHARACTER_OUTPUT
```

Do not put shell substitutions such as `$(openssl ...)` directly in `.env`; dotenv files do not evaluate them.

Start the stack:

```bash
docker compose up -d
```

Open `http://localhost:3000`. On first boot, OpsKnight sends you to `/setup`. Create the first Admin, copy the generated temporary password when it is shown, and sign in.

### Checkpoint

You are done with this step when the OpsKnight dashboard loads successfully.

## 2. Create the minimum incident-routing chain

For the first test, use yourself as the responder. You do not need a second user or an external notification provider yet.

1. **Team** — create `Platform` and add yourself.
2. **Schedule** — create `Platform Primary` and add yourself to a layer covering the current time.
3. **Escalation Policy** — create `Platform Page` with one step targeting `Platform Primary`.
4. **Service** — create `Checkout API`, owned by `Platform`, using `Platform Page`.

```text
user → team → schedule → escalation policy → service
```

### Checkpoint

Open `Checkout API` and verify the expected owning team and escalation policy are attached. For a production-ready setup with multiple responders, notification channels, overrides, ownership, and escalation testing, continue with [First Steps](./first-steps).

## 3. Create and verify your first incident

1. Open **Incidents** → **Create Incident**.
2. Set the title to `TEST: Checkout API incident`.
3. Select `Checkout API`.
4. Set urgency to **High**.
5. Create the incident.

Verify that the incident appears as `OPEN`, the timeline records the lifecycle, and the expected escalation target is shown. Select **Acknowledge**, then **Resolve**, and add a short resolution note.

### Checkpoint

Your core OpsKnight flow is working when one incident moves successfully through:

```text
OPEN → ACKNOWLEDGED → RESOLVED
```

## 4. Verify inbound event ingestion

This step is optional for the first UI test, but recommended before connecting a real monitoring system.

Open `Checkout API` → **Integrations**, create an **Events API** integration, and copy its integration key into secure temporary storage.

Trigger an incident:

```bash
curl --request POST "http://localhost:3000/api/events" \
  --header "Authorization: Token token=YOUR_INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "event_action": "trigger",
    "dedup_key": "getting-started/checkout-api",
    "payload": {
      "summary": "TEST: Checkout API alert",
      "source": "getting-started",
      "severity": "critical"
    }
  }'
```

Resolve the same incident by reusing the integration key and `dedup_key`:

```bash
curl --request POST "http://localhost:3000/api/events" \
  --header "Authorization: Token token=YOUR_INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "event_action": "resolve",
    "dedup_key": "getting-started/checkout-api",
    "payload": {
      "summary": "TEST: Checkout API recovered",
      "source": "getting-started",
      "severity": "info"
    }
  }'
```

The trigger and resolve events should affect the same incident rather than create two independent incidents. See the [Events API](../api/events) for the complete contract.

## 5. Check application health

```bash
curl -s http://localhost:3000/api/health
```

A healthy local installation should report `"status":"healthy"`. A `"degraded"` result means the application is running but at least one non-database health check needs attention.

If the UI does not load or the health endpoint fails, use [Troubleshooting](../troubleshooting).

## What to configure next

| Goal | Continue with |
| --- | --- |
| Page responders outside the browser | [Notifications](../administration/notifications) |
| Connect monitoring | [Integrations](../integrations) |
| Build a multi-person on-call rotation | [First Steps](./first-steps) |
| Publish incident communication | [Status Page](../core-concepts/status-page) |
| Add Slack incident collaboration | [Slack ChatOps](../integrations/communication/slack-chatops) |
| Configure OIDC SSO | [OIDC](../security/oidc-setup) |
| Prepare a production deployment | [Deployment](../deployment) |

## First-run acceptance checklist

- [ ] OpsKnight starts and the Admin can sign in.
- [ ] The service has the expected team and escalation policy.
- [ ] A manual incident can be opened, acknowledged, and resolved.
- [ ] An Events API trigger reaches the correct service.
- [ ] Reusing the same `dedup_key` for resolve updates the same incident.
- [ ] `/api/health` reports the expected state.

Once these checks pass, the core incident path is ready and you can layer on production integrations, notification providers, and operational controls.
