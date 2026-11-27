---
title: Upgrade to OpsKnight 2.3.0
description: What changes when you upgrade from 2.2.x to 2.3.0 (Node.js 22 and Prisma 7.3.0 on the node-postgres driver), how to check your database connections first, apply the upgrade, and recover from a failed migration, plus the Slack and Microsoft Teams ChatOps changes and the optional steps to switch them on.
type: deployment
product_area: upgrades
audience: [operator, administrator]
keywords: [upgrade to 2.3.0, 2.3.0 upgrade notes, Prisma 7 upgrade, Node.js 22, sslmode verify-full, database TLS]
reader:
  status: READER_COMPLETE
  task: Prepare, apply, verify, and if necessary recover an upgrade from OpsKnight 2.2.x to 2.3.0.
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - package.json
    - prisma.config.ts
    - src/lib/db/create-client.ts
    - src/lib/db/pg-config.ts
    - src/lib/db/raw-parameter-types.ts
    - scripts/db/check-connection.cjs
    - deploy/kubernetes/helm/opsknight/templates/migration-job.yaml
    - Dockerfile
    - src/lib/slack/incident-card.ts
    - src/lib/slack/live-card.ts
    - src/lib/microsoft-teams/cards.ts
    - src/lib/microsoft-teams/health-checklist.ts
    - prisma/migrations/20261204100000_slack_incident_message
    - prisma/migrations/20261204100100_chatops_slack_war_room_settings
    - prisma/migrations/20261204100200_user_slack_dm_notifications
    - prisma/migrations/20261204100400_teams_secret_expiry_activity
---
# Upgrade to OpsKnight 2.3.0
This page covers what is different about the 2.2.x to 2.3.0 upgrade. Follow it together with the
general [upgrade runbook](./upgrade), and keep the [rollback runbook](./rollback) open during the change.
## What changes in 2.3.0
- **Prisma 5.22 to Prisma 7.3.0.** The database layer now runs on the `node-postgres` (`pg`) driver
  through Prisma's driver adapter. Your existing `DATABASE_URL`, `DIRECT_DATABASE_URL`,
  `WEB_DATABASE_URL`, and `MCP_DATABASE_URL` values keep working, and the Prisma URL parameters
  (`connection_limit`, `pool_timeout`, `connect_timeout`, `schema`, `options`, `pgbouncer`, and the
  `ssl*` parameters) keep their meaning. The schema is unchanged and the data is not rewritten.
- **Node.js 22 LTS** replaces Node.js 20. The image is `node:22-alpine`. Anything you run outside the
  image (scripts, CI, local development) needs Node.js 22.12 or newer within 22.x.
- **Prisma is pinned exactly** (`prisma`, `@prisma/client`, `@prisma/adapter-pg`,
  `@prisma/driver-adapter-utils` at 7.3.0). Do not float these versions.
- **PgBouncer 1.26.1** replaces 1.26.0 in the deployment defaults and the custom pooler image.
  It fixes SCRAM impersonation and startup-packet denial-of-service issues described in the
  [upstream changelog](https://www.pgbouncer.org/changelog.html). Deployments that override
  `PGBOUNCER_IMAGE`, `OPSKNIGHT_PGBOUNCER_IMAGE`, or `pgbouncer.image` must update their override
  to a verified patched image too. Recreate or roll out the pooler containers; restarting the
  application alone does not update PgBouncer. Allow clients to reconnect during the rollout.
## Behaviour changes to prepare for
### Database TLS now verifies certificates
Earlier releases treated `sslmode=verify-ca` and `sslmode=verify-full` like `prefer`: the certificate
was never verified and the connection could fall back to plaintext. 2.3.0 applies libpq semantics:

| `sslmode` | 2.3.0 behaviour |
| --- | --- |
| `disable` | No TLS. |
| `allow` / `prefer` | Negotiated like libpq; the certificate is not verified. |
| `require` | TLS, certificate not verified unless `sslrootcert` is set. |
| `verify-ca` / `verify-full` | TLS with a verified certificate (and host name for `verify-full`). **Needs the CA**: set `sslrootcert=/path/ca.crt`, or `NODE_EXTRA_CA_CERTS`. |
| anything else | Configuration error; the connection fails closed. |

A deployment that already says `verify-full` but never supplied a CA worked before by accident and
**will fail to connect after the upgrade**. Run the connection check below before you upgrade.
### Sessions run in UTC
Every connection sets `TimeZone=UTC`. Results are now identical on servers whose default time zone is
not UTC (Prisma 5 could miss rows or shift raw-SQL writes by the offset). No action is needed.
### Failed connections are retried consistently
Every connection failure now carries a code, and a first-connection failure during a database outage is
classified retryable, like later outages. Escalation steps retry instead of failing permanently.
## Slack and Microsoft Teams ChatOps

2.3.0 also brings the Slack and Teams integrations up to date. Nothing here needs action on upgrade; the optional steps below switch on the extra features.

What changes for responders:

- **Slack channel alerts are one live card per incident.** The card is edited as the incident is acknowledged, snoozed, escalated, and resolved, with a short thread reply for each change, instead of a new message for every event. Buttons now include **Snooze**, **Escalate**, and **Assign to me**, and **Resolve** and **Escalate** ask for confirmation. Messages posted before the upgrade, and messages sent through an incoming webhook, keep posting new messages. See [Slack incident notifications](../../integrations/communication/slack/incident-notifications).
- **Every escalation refreshes the Slack and Teams cards**, whether it came from the engine, the web app, the API, Slack, or Teams.
- **Slack war rooms** get a welcome message, a pinned status card with the description, room settings for private rooms and delayed archiving (both off by default), and 📌 reactions that save a message as an incident note. See [war rooms](../../integrations/communication/slack/war-rooms).
- **`/incident declare`** has priority, visibility, and assignee fields, and **`/incident list`** and **`/incident oncall`** work in any channel. See [commands](../../integrations/communication/slack/commands).
- **Pull people in and change the incident from Slack:** `/incident page`, `assign`, `priority`, `urgency`, `title`, `describe`, and `status`, plus a **More actions** menu with Add responder, Reassign, Update details, and Post status update. See [commands](../../integrations/communication/slack/commands).
- **Runbooks and action items from Slack:** `/incident runbook` previews and runs a runbook, and `/incident action` adds a follow-up. A **Join meeting** button appears on the card when the incident has a bridge.
- **Shortcuts and the Home tab:** declare an incident from any message, and a Home tab with who is on call and the open incidents. See [shortcuts and the Home tab](../../integrations/communication/slack/shortcuts-and-app-home).
- **Reminders, routing, and on-call sync (all off until set):** nudges when an incident is unacknowledged or has had no update, limiting a channel by priority or urgency, inviting the on-call responder to war rooms, and keeping a Slack user group equal to who is on call. See [notifications](../../integrations/communication/slack/incident-notifications), [service channels](../../integrations/communication/slack/configure-service-channels), and [on-call user groups](../../integrations/communication/slack/on-call-user-groups).
- **Squire answers `@OpsKnight` mentions in ordinary Slack channels**, not only incident rooms. See [Ask Squire in Slack](../../guides/intelligence/squire-everywhere).
- **Microsoft Teams cards** have a header colour that follows the state, a single status badge, who acknowledged or resolved the incident, a distinct escalated card, local-time timestamps, and **Acknowledge** and **Resolve** on the posted card. The person who clicks sees the updated card immediately.
- **Slack and Teams settings show live health checks**, including a notice when the Slack app was installed from an older manifest and a warning before a Teams client secret expires.

Behaviour changes for administrators:

- The service's notify switches stop **new** Slack and Teams posts only; an existing card is still updated so it never shows a stale state.
- A Slack rate limit (HTTP 429) is retried after the delay Slack asks for and is never treated as "might have been delivered". Teams card updates handle 429 and server errors, re-post a card that was deleted, and recover from an uncertain create after 10 minutes instead of silencing the channel.
- Slack OAuth handles Enterprise Grid installs and rotating tokens, and no longer logs OAuth state values. Teams sign-in validation throttles key refetches, tolerates 5 minutes of clock skew, and rejects a single-tenant install whose tenant id is empty or does not match.
- The Teams settings page no longer sends the whole configuration row, including the encrypted client secret, to the browser.

Database: the migrations are additive. They add the `SlackIncidentMessage` and `SlackOnCallSync` tables and nullable or defaulted columns on `ChatOpsConfig`, `SlackIntegration`, `SlackDestination`, `User`, `MicrosoftTeamsConfig`, and `MicrosoftTeamsInstallation`. Nothing is rewritten or removed, so [rolling back](./rollback) leaves them in place and unused.

### Optional steps after upgrading

1. **Slack:** under **Settings → Integrations → Slack**, select **Copy manifest**, paste it under **App Manifest** in the Slack API console, save, then select **Reconnect Slack**. This switches on pinned and bookmarked status cards, direct-message paging, posting to public channels without inviting the bot, and Squire posting under its own name, plus the **Declare incident** shortcuts, the Home tab, user-group sync, and Slack Connect invitations. See [permissions and scopes](../../integrations/communication/slack/permissions-and-scopes).
2. **Microsoft Teams:** under **Settings → Integrations → Microsoft Teams**, select **Download updated app package** (version 1.4.0) and upload it to Teams, to get Squire by `@OpsKnight` mention and direct message and the bot's command list. The existing 1.3.0 package keeps working.

## Password hashes remain compatible
bcryptjs 3 writes new local-password hashes with the `$2b$` prefix instead of `$2a$`.
Existing password hashes remain valid; no password reset or database rewrite is required.
The hashing cost stays at 12, and the password policy keeps its 72-byte UTF-8 limit.
## Prerequisites
- You run OpsKnight 2.2.x. From earlier versions, upgrade to 2.2.x first.
- A restored-and-verified backup with the matching encryption keys and secrets.
- The previous image digest and its full configuration.
- A maintenance window: the application is stopped while migrations run.
## Check database connections before upgrading
Run the new image with your **existing** configuration. It connects every configured database URL
with 2.3.0's TLS rules, and reports encryption, certificate verification, and a hint when something
would fail (for example a missing `sslrootcert`). It never prints credentials.
```bash
docker run --rm --env-file opsknight.env [-v /path/ca.crt:/path/ca.crt:ro] \
  ghcr.io/opsknight-labs/opsknight:2.3.0 node scripts/db/check-connection.cjs
```
It exits `1` if any configured URL cannot connect. Fix the URL or mount the CA, and rerun until it exits `0`.
## Apply the upgrade
Follow the [upgrade runbook](./upgrade) for your topology (Compose, Kubernetes/Helm/Kustomize, Swarm).
The image runs `prisma migrate deploy` through `prisma.config.ts`, the same migration ownership as
before: one migration owner (the Helm migration Job, or the single migration container), never every
replica.
Migrations stay atomic: the pinned Prisma 7.3.0 CLI applies each migration file in one transaction,
as 2.2.x did, so a failed migration leaves no partial changes. If one fails, follow
[migration fails](../../troubleshooting/upgrades/migration-fails) and run `npm run prisma:health`;
never edit `_prisma_migrations` or run `prisma db push`.
**Do not upgrade the Prisma CLI past 7.3.0 on your own.** From 7.4.0 the CLI applies migration
statements one at a time (prisma/orm#30640), which breaks the migration history on a fresh database
(a temporary table created `ON COMMIT DROP`) and makes failed migrations non-atomic. OpsKnight raises
the pin only after its migrations are certified against the newer CLI.

## Verify
1. `GET /api/health` reports healthy on every runtime role, and `/api/health/deep` confirms the database path.
2. `npm run prisma:validate` and `npm run prisma:health` pass against the upgraded database.
3. The logs contain no `db.config.warning` or `db.config.invalid` events. These name a URL setting that
   2.3.0 ignored or rejected, with the target (never the password).
4. Send a synthetic alert and confirm the incident, notification, and acknowledgement path end to end.
## Roll back
Prisma 7 does not change the schema, but 2.3.0 includes forward migrations; use the
[rollback runbook](./rollback). 
## Known limits
- Prisma is held at 7.3.0 on purpose (see above). Newer 7.x releases and Prisma 8 (a release candidate when 2.3.0 was cut) are separate, certified changes.
- The `$metrics` client API no longer exists in Prisma 7. OpsKnight's pool-pressure checks read the
  `pg` pool's waiting-connection count instead, and they report "unknown" (never zero) for clients it
  did not create.
