---
order: 1
title: Getting Started
description: Fifteen minutes from Compose to a test page
---

# Getting Started

This is the **15-minute path**: Compose up, admin account, a service that can page you, one test incident. Use the other guides in this section when you need install variants or a fuller first-week setup.

| Minutes | What you do                        | Done when                                   |
| ------- | ---------------------------------- | ------------------------------------------- |
| 0–5     | Run Compose and create the admin   | You can sign in at `http://localhost:3000`  |
| 5–12    | Team → schedule → policy → service | The service routes to your current schedule |
| 12–15   | Open a test incident               | It appears OPEN; you can acknowledge it     |

Notifications (email/SMS/Slack) are optional for this path. Without a provider, the incident still exists; nobody is paged off-box.

---

## 1. Run OpsKnight (Compose)

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight
cp env.example .env
```

Generate the two secrets, then paste the output values into `.env` before you start:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

```dotenv
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=PASTE_BASE64_OUTPUT
ENCRYPTION_KEY=PASTE_64_HEX_CHARACTER_OUTPUT
```

Dotenv files do not evaluate `$(...)` shell substitutions.

The Compose file constructs the application's container-only `DATABASE_URL` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`; you do not need to change the host-development `DATABASE_URL` example for this path.

```bash
docker compose up -d
open http://localhost:3000
```

First boot sends you to `/setup`. Create the admin, **copy the generated password once**, then sign in.

Helm, Kustomize, and from-source installs: [Installation](./installation). Env reference: [Configuration](./configuration).

---

## 2. Make something that can page

Stay on this machine. You do not need a second user for a first page.

1. **Teams** — create `Platform` and add yourself.
2. **Schedules** — create `Platform primary`, add yourself on a 24×7 layer (or a short override covering now).
3. **Policies** — create `Platform page`, one step: notify the schedule, a few minutes before the next step (you will ack before that).
4. **Services** — create `Checkout API`, attach that policy.

Detail and screenshots: [First Steps](./first-steps).

---

## 3. Fire a test incident

**In the UI**

1. **Incidents** → **Create Incident**
2. Title `Test page`, service `Checkout API`, urgency High
3. Create

You should see status `OPEN` and a timeline entry. Click **Acknowledge**, then **Resolve**.

**Optional: Events API** (after you add an integration key on the service)

```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Token token=YOUR_INTEGRATION_KEY" \
  -d '{
    "event_action": "trigger",
    "dedup_key": "getting-started-test-1",
    "payload": {
      "summary": "Test page from getting started",
      "severity": "critical",
      "source": "getting-started"
    }
  }'
```

See [Events API](../api/events).

---

## 4. Confirm the install

```bash
curl -s http://localhost:3000/api/health
```

Expect `"status":"healthy"` (or `"degraded"` only if a non-database check failed). If the UI never loads, [Troubleshooting](../troubleshooting).

---

## After the first page

| Next job                                          | Guide                                                        |
| ------------------------------------------------- | ------------------------------------------------------------ |
| Email / SMS / Slack so a real page leaves the box | [Notifications](../administration/notifications)             |
| One public/private status page                    | [Status page](../core-concepts/status-page)                  |
| Slack war rooms (this version)                    | [Slack ChatOps](../integrations/communication/slack-chatops) |
| Ingest from monitoring                            | [Integrations](../integrations)                              |
| OIDC SSO (not SAML)                               | [OIDC](../security/oidc-setup)                               |

There is **no voice** channel. Microsoft Teams and Google Chat are webhook formats, not Slack-style rooms.
