---
title: OpsKnight 2.2.0 documentation
description: Documentation for the released OpsKnight 2.2.0 product, including AI assistants (MCP), guided single sign-on, maintenance windows, and dark mode.
type: concept
product_area: documentation
audience:
  - operator
  - administrator
verification:
  level: source
  verified_at: 2026-11-20
  evidence: [docs/versions.json, docs/v2.2.0/capabilities.yaml, scripts/sync-docs-to-website.sh]
---

# OpsKnight 2.2.0 documentation

This is the documentation for the released **OpsKnight 2.2.0** product.
`v2.2.0` is the current release and is listed in `releasedVersions` in
`docs/versions.json`, so the release-gated documentation sync publishes it.
Earlier releases keep their own documentation sets (for example `docs/v2.1.0`),
published under their own version.

The baseline documentation is grounded in product evidence. Historical
documentation can help locate a topic, but it is never authoritative.

## New in 2.2.0

Upgrading from 2.1.x? Read [Upgrade to 2.2.0](./operate/upgrades/upgrade-to-2.2.0) first: it covers
the migrations, the HTTPS default for outgoing webhooks, older integration keys, the 60-minute default
snooze, known limitations, and rollback.

- **AI assistants (MCP)**, off by default:
  [overview](./guides/mcp/README.md), [self-hosted setup](./guides/mcp/self-hosted-setup.md), the
  [stdio bridge](./guides/mcp/stdio-bridge.md), [what to ask](./guides/mcp/what-to-ask.md),
  [build an agent](./guides/mcp/build-an-agent.md), [security and data](./guides/mcp/security-and-data.md),
  [troubleshooting](./guides/mcp/troubleshooting.md), [permissions](./reference/mcp/permissions.md), the
  [tool reference](./reference/mcp/tools.md), and for operators the
  [architecture](./operate/mcp/architecture.md), [monitoring](./operate/mcp/monitoring.md), and
  [release status](./operate/mcp/certification.md).
- **Guided single sign-on**: [single sign-on guides](./guides/identity/README.md), including
  [role and team rules](./guides/identity/map-roles-and-teams.md) and
  [linking existing accounts](./guides/identity/link-existing-accounts.md), plus
  [sign-in troubleshooting](./troubleshooting/login/README.md).
- **Maintenance windows**: [hold alerts during planned work](./guides/services/maintenance-windows),
  one-off or recurring.
- **Dark mode**: choose System, Light, or Dark under
  [profile and preferences](./guides/profile/manage-profile-and-preferences).
- **Integrations**: Slack [`/incident` now needs the `commands` scope](./integrations/communication/slack/permissions-and-scopes.md);
  copied [integration URLs](./guides/integrations/README.md) take their hostname from
  **Settings → System → App URL** first.
- **Helm**: the [pre-upgrade runtime gate](./operate/deploy/helm/upgrade-gate.md) no longer stops every
  Deployment for values-only upgrades.

- **Analytics rebuilt**: [Analytics](./guides/analytics/README.md) uses one exact metrics module, with
  sections, ranges up to 3 years, comparison, time zones, metric definitions and the CSV export
  ([use Analytics](./guides/analytics/use-analytics.md)).

An organisation-wide workflow builder and alert correlation (AIOps) are not part of 2.2.0. Workflow
automation in this release is [per-service automation](./guides/services/service-automation).

## Intelligence (AIOps)

- [Use suggestions](./guides/intelligence/use-suggestions.md) and [basic-mode questions](./guides/intelligence/basic-mode.md)
- [AIOps overview](./guides/intelligence/aiops-overview.md), [alerts and changes lists](./guides/intelligence/alerts-and-changes-lists.md), [intelligence on incidents and lists](./guides/intelligence/incidents-and-lists.md)
  and [noise-control builders](./guides/intelligence/noise-control-builders.md)
- [Intelligence on services, teams and dashboards](./guides/intelligence/services-teams-and-dashboards.md)
- Operating: [production guide](./operate/intelligence/production.md)

## Start here

- [Evaluate with Docker Compose](./start/quickstart)
- [Create and resolve a first incident](./start/first-incident)
- [Plan a production installation](./start/production-install)
- [Migrate from a 1.x deployment](./start/migrate-from-v1)

## Respond and operate

- [Understand service automation](./concepts/service-automation),
  [configure and roll it out](./guides/services/service-automation), and review
  its [exact contracts](./reference/service-automation).

- [Understand Runbook safety](./concepts/runbooks) and follow the
  [Runbooks guides](./guides/runbooks/) to author, bind, and execute workflows.
- [Install outbound Agents](./operate/deploy/agent-operations), manage
  [pools and scoped secrets](./guides/runbooks/agents-pools-secrets), and
  [diagnose execution issues](./troubleshooting/runbooks/).

- [Create](./guides/incidents/create), [acknowledge](./guides/incidents/acknowledge),
  [assign](./guides/incidents/assign), and [resolve](./guides/incidents/resolve)
  incidents.
- [Build an on-call schedule](./guides/on-call/build-schedule) and manage
  [temporary overrides](./guides/on-call/overrides).
- [Configure escalation](./guides/escalation/configure-policy) and
  [notification routing](./guides/notifications/configure-routing).
- [Publish a status update](./guides/status-pages/publish-update) and create a
  [ChatOps war room](./guides/chatops/create-war-room).

## Connect systems

- Browse the [integration catalog](./integrations/) for monitoring, cloud,
  uptime, source-control, communication, issue-tracking, and generic webhook
  providers.
- Configure [Slack](./integrations/communication/slack),
  [Microsoft Teams](./integrations/communication/microsoft-teams),
  [voice paging](./integrations/communication/voice), or
  [Jira](./integrations/issue-tracking/jira).

- [Operate service automation](./operate/reliability/service-automation) and
  [diagnose automation problems](./troubleshooting/service-automation).

## Run in production

- [Choose a deployment topology](./operate/deploy/), then follow the complete
  [Compose](./operate/deploy/docker-compose/),
  [Kubernetes](./operate/deploy/kubernetes/), or multi-node path.
- Plan [scaling](./operate/reliability/scaling),
  [hardening](./operate/security/hardening),
  [backup and restore](./operate/data/backup-and-restore), and
  [upgrades](./operate/upgrades/upgrade), starting with
  [Upgrade to 2.2.0](./operate/upgrades/upgrade-to-2.2.0).

## Exact contracts

- [API inventory](./reference/api/)
- [Configuration](./reference/configuration/)
- [Permissions](./reference/permissions)
- [Notification delivery](./reference/notifications/)
- [Webhooks](./reference/webhooks)
- [Health](./reference/health), [metrics](./reference/metrics), and
  [runtime limits](./reference/limits)

## Evidence order

When sources conflict, use this order:

1. Current executable behavior
2. Current tests
3. Current source code and configuration
4. Historical documentation

Documentation must not claim behavior that cannot be verified against one of
the first three sources.

## Documentation sections

- **Start** — install OpsKnight and complete a first incident.
- **Concepts** — understand the product model and why it behaves as it does.
- **Guides** — complete responder and administrator tasks.
- **Integrations** — connect alert sources and collaboration systems.
- **Operate** — deploy, secure, scale, back up, and upgrade OpsKnight.
- **Reference** — exact API, configuration, permission, and runtime contracts.
- **Troubleshooting** — diagnose symptoms using observable evidence.
- **Develop** — build, test, and contribute to OpsKnight.
