---
title: OpsKnight 2.1.0 documentation
description: Upcoming OpsKnight 2.1.0 documentation, including Runbook authoring and incident remediation.
type: concept
product_area: documentation
audience:
  - operator
  - administrator
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [docs/versions.json, scripts/sync-docs-to-website.sh]
---

# OpsKnight 2.1.0 documentation

This is the documentation for the upcoming **OpsKnight 2.1.0** product.
The baseline pages and assets are copied from `v2.0.0`, with Runbooks guidance
added for this version. Existing deployment examples retain their verified
2.0.0 image references; this documentation does not claim a 2.1.0 image is released.
`docs/versions.json` registers `v2.1.0` as upcoming, while `v2.0.0` remains the
current release. Normal release-gated documentation sync skips upcoming versions.
For a documentation preview, explicitly use `DOCS_SYNC_INCLUDE_UPCOMING=true`.

The baseline documentation is grounded in product evidence. Historical
documentation can help locate a topic, but it is never authoritative.

## Start here

- [Evaluate with Docker Compose](./start/quickstart)
- [Create and resolve a first incident](./start/first-incident)
- [Plan a production installation](./start/production-install)
- [Migrate from a 1.x deployment](./start/migrate-from-v1)

## Respond and operate

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

## Run in production

- [Choose a deployment topology](./operate/deploy/), then follow the complete
  [Compose](./operate/deploy/docker-compose/),
  [Kubernetes](./operate/deploy/kubernetes/), or multi-node path.
- Plan [scaling](./operate/reliability/scaling),
  [hardening](./operate/security/hardening),
  [backup and restore](./operate/data/backup-and-restore), and
  [upgrades](./operate/upgrades/upgrade).

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
