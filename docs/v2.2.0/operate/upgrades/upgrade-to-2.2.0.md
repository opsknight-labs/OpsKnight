---
title: Upgrade to OpsKnight 2.2.0
description: What changes when you upgrade from 2.1.x to 2.2.0, how to prepare, apply, and verify the upgrade, the known limitations, and how to roll back.
type: deployment
product_area: upgrades
audience: [operator, administrator]
keywords: [upgrade to 2.2.0, 2.2.0 upgrade notes, 2.2.0 release notes, OpsKnight 2.2]
reader:
  status: READER_COMPLETE
  task: Prepare, apply, verify, and if necessary roll back an upgrade from OpsKnight 2.1.x to 2.2.0.
verification:
  level: source
  verified_at: 2026-11-20
  evidence:
    - prisma/migrations/20261119000100_integration_legacy_stored_key/migration.sql
    - prisma/migrations/20261119000200_system_allow_insecure_webhook_urls/migration.sql
    - prisma/migrations/20261117000400_incident_maintenance_window_index/migration.sql
    - src/app/api/events/route.ts
    - src/app/(app)/settings/system/page.tsx
    - src/components/settings/OutboundWebhookSettings.tsx
    - src/lib/incidents/lifecycle.ts
    - deploy/kubernetes/helm/opsknight/templates/migration-job.yaml
---

# Upgrade to OpsKnight 2.2.0

This page covers what is different about the 2.1.x to 2.2.0 upgrade. Follow it together with the
general [upgrade runbook](./upgrade), which covers backups, digests, migration ownership, and
topology-specific commands, and keep the [rollback runbook](./rollback) open during the change.

## What is new in 2.2.0

- **AI assistants (MCP)**: a native MCP server at `<App URL>/mcp` with per-person sign-in and
  human-approved changes. It is **off by default**; an administrator turns it on. See
  [AI assistants](../../guides/mcp/) and its [release status](../mcp/certification).
- **Guided single sign-on** in four steps, specific sign-in messages, role rules v2, group-to-team
  rules, and linking at scale. See [single sign-on](../../guides/identity/).
- **Service maintenance windows**, one-off or recurring. See
  [maintenance windows](../../guides/services/maintenance-windows).
- **Dark mode** for the console and the mobile app (**System**, **Light**, or **Dark**). See
  [profile and preferences](../../guides/profile/manage-profile-and-preferences).
- Workflow automation in 2.2.0 is **per-service automation rules** (**Services → Automations**). See
  [service automation](../../guides/services/service-automation).
- A bug sweep with 194 user-impacting fixes, and Next.js 16.4.6 for seven security advisories.

An organisation-wide workflow builder and alert correlation (AIOps) are **not** part of 2.2.0; they are
planned for a later release.

## Prerequisites

- You run OpsKnight 2.1.x. From 1.x, first follow [Migrate from 1.x](../../start/migrate-from-v1).
- A recent backup that you have restored in an isolated environment, with the matching encryption keys
  and secrets.
- The previous image digest and its full configuration, recorded so you can return to them.
- A maintenance window: an image upgrade from 2.1.x needs the application stopped while migrations run
  (see [Apply the upgrade](#apply-the-upgrade)).

## Prepare for the behaviour changes

Read each change below and decide whether it needs action before you upgrade.

### Database migrations

2.2.0 adds 68 migrations since 2.1.2 (durable event ingestion, MCP, single sign-on, access control,
SCIM group roles, Analytics views and weekly digest, theme preference, maintenance windows, live views
after renames, and the two release fixes below). They add tables, columns, and
indexes and backfill values; none drops or renames a table or column. One index,
`Incident_maintenanceWindowId_status_idx`, is built with `CREATE INDEX CONCURRENTLY` in its own
migration so alert ingestion is not blocked while it builds; on a large `Incident` table allow extra
time for it. See [database migrations](./database-migrations).

### Integration routing keys created before 2.2.0

Before 2.2.0 the service page showed the encrypted integration key instead of the key itself, and
`/api/events` accepted that encrypted value. 2.2.0 fixes this, and every existing integration is marked
`Integration.legacyStoredKeyAccepted`, so senders configured with the value the old page showed keep
working and live alerting does not break. Keys created or rotated after the upgrade never accept the
stored value. When convenient, rotate each older integration key and update the sender to retire the
legacy value.

### Outgoing service webhooks require HTTPS

Outgoing service webhooks must use `https://` by default; the URL is checked when it is saved and when
it is sent. An administrator can allow `http://` in **Settings → System → Application URL → Outgoing
webhooks** (**Allow http:// webhook URLs**). If any service webhook already uses `http://`, the upgrade
turns this switch on automatically so nothing stops sending. Private and internal network targets stay
blocked either way. After the upgrade, move those webhooks to HTTPS and turn the switch off.

### Teams with open work cannot be deleted

A team with open incidents or escalation steps can no longer be deleted. Reassign or resolve that work
first. Automation that deletes teams must handle the refusal.

### Snooze without an end time ends after 60 minutes

A snooze without an end time now ends after 60 minutes instead of lasting forever. Incidents that need a
longer pause should be snoozed with an explicit end time.

### REST API v2 service updates are team-scoped

API v2 service updates are limited to the services of the caller's own teams; administrators keep global
access. Check API keys and integrations that update services owned by other teams, and use an
administrator key or the owning team's key for them.

### Incident visibility

Incident `PUBLIC` and `PRIVATE` visibility controls the status page only. Slack and Microsoft Teams war
rooms are unchanged.

### Slack `/incident`

The Slack app now needs the `commands` scope for `/incident`. Workspaces connected on 2.1 must reconnect;
see [Slack permissions and scopes](../../integrations/communication/slack/permissions-and-scopes).

## Apply the upgrade

1. Take and verify the backup, and record the current image digest and configuration.
2. Stop every application role (integrated, web, workers, scheduler). On Helm, the
   [pre-upgrade runtime gate](../deploy/helm/upgrade-gate) refuses an image upgrade until every
   application Deployment is at zero replicas; on Compose, Swarm, and Kustomize, stop the roles
   yourself so no 2.1 process writes to the new schema.
3. Run the migrations once, from the 2.2.0 image, with the normal migration owner for your topology.
4. Start the 2.2.0 roles and wait until each one is healthy.

The topology commands are in the [upgrade runbook](./upgrade#roll-out-by-topology).

## Verify the upgrade

1. Complete the checks in [verify the upgrade](./upgrade#verify-the-upgrade), including
   `GET /api/health?mode=readiness` on every role and `npm run prisma:health` reporting no unfinished
   migration. **Settings → System → Health** should show no new failures.
2. Send a test event to an existing integration with its existing key and confirm an incident opens and
   pages.
3. Trigger an existing outgoing service webhook and confirm it is delivered.
4. Sign in with single sign-on, if you use it, and with a local administrator account.
5. Open **Settings → Profile → Appearance & Time** and confirm the theme switch works.

## Operate the upgraded release

- MCP stays off until an administrator turns it on. Read
  [self-hosted setup](../../guides/mcp/self-hosted-setup) and [security and data](../../guides/mcp/security-and-data)
  before enabling it, and set up [MCP monitoring](../mcp/monitoring).
- Review the HTTPS webhook switch and legacy integration keys from the steps above and retire them on
  your own schedule.

## Known limitations

- **Export downloads show no size or progress.** Next.js 16.4.5 and later drop a route handler's
  `Content-Length` header (vercel/next.js#101854). Audit, report, and dashboard exports still complete
  and can be checked with their `X-Content-SHA256` header; browsers show no size or progress until a
  Next.js release includes the upstream fix.
- **Service automation browser certification.** The browser suite for service automation
  (`automation-validation.yml`) has failing tests that predate this release; the automation unit and
  integration tests pass.
- **High-throughput event ingestion is not certified.** Validate peak ingestion rates in your own
  environment.
- **External secrets (Secrets Store CSI) are not certified.** Live Kubernetes CSI synchronization and
  recovery, AWS and Azure workload identity, rotation, and OpenShift results are pending; validate it in
  your environment before production use.
- **MCP release certification is not signed.** MCP ships off by default; see
  [MCP release status](../mcp/certification) for what was and was not verified.

## Roll back

Choose the path in the [rollback runbook](./rollback); for 2.2.0 specifically:

- **Prefer a forward fix** when the schema migrated cleanly. 2.2.0 data such as MCP grants, maintenance
  windows, and single sign-on rules would be ignored by a 2.1 runtime.
- **Image rollback to 2.1.x** is possible in principle because the migrations only add schema, but it
  has not been certified for this release. If you take it, stop every 2.2.0 role first, do not run the
  2.1 image's migrations, and expect held maintenance-window incidents, MCP connections, and new SSO
  settings to stop working until you upgrade again.
- **Stop writes and restore** the pre-upgrade backup if a migration failed part-way or the data cannot be
  trusted. Writes after the backup are lost.

Never delete `_prisma_migrations` rows or hand-write down-migrations.

## Troubleshooting

- **Helm upgrade fails at `<release>-opsknight-auth-cutover`:** an application Deployment still has
  replicas or pods. Scale them to zero and retry; see the [runtime gate](../deploy/helm/upgrade-gate).
- **A monitoring tool stopped creating incidents:** confirm it still sends the same key. Keys rotated
  after the upgrade no longer accept the old displayed value.
- **An outgoing webhook is refused:** the URL uses `http://`, or points at a private or internal
  address. Use HTTPS, or allow `http://` under **Outgoing webhooks**.
- **Deleting a team fails:** it still has open incidents or escalation steps.
- **A service update through API v2 returns forbidden:** the key's user is not on the owning team.
