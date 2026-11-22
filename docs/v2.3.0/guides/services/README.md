---
title: Service administration tasks
order: 1
description: Create and operate service ownership, escalation, notification, integration, and lifecycle settings.
type: concept
product_area: services
audience: [administrator, responder]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/app/(app)/services] }
---

# Service administration tasks

A service is the operational boundary for incidents, ownership, escalation,
notifications, integrations, ChatOps, Jira, and status communication. Follow
[Create and manage a service](./manage-service) for the full lifecycle. Read
[Services](../../concepts/services) for data model and authorization semantics.

Configure alert context, enrichment, and escalation routing with
[Configure and roll out service automation](./service-automation), or follow the
[API authoring walkthrough](./service-automation-api).

Explore [starter templates and worked examples](./service-automation-examples),
then use the [production operations guide](../../operate/reliability/service-automation).

To attach remediation workflows and configure incident-created triggers, follow
[Bind Runbooks and respond to incidents](../runbooks/respond).

Pause paging during planned work with
[maintenance windows](./maintenance-windows), one-off or recurring.

Group services into what customers rely on with
[business services](./business-services).

See how business services and technical services depend on each other, with live health, in the
[service graph](./service-graph).

Page on fast error-budget spend for an availability objective with
[SLO burn-rate alerts](../slo-burn-alerts).
