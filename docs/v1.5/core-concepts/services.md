---
title: Services
description: Model service ownership, incident routing, health, SLAs, notifications, and integrations.
order: 3
---

# Services

A service is the routing and reporting boundary for incidents. It joins an owning team, escalation policy, integration keys, notification behavior, SLA targets, Jira mapping, Slack war-room behavior, status-page visibility, and incident history.

## Permissions

- Signed-in users can view the service directory and service details.
- **Responders** and **Admins** can create services and manage settings and integrations.
- Only an **Admin** can delete a service.

## Create a service

1. Open **Services**.
2. Select **Create New Service**.
3. Enter a unique service name.
4. Optionally select an owning team, SLA tier, and escalation policy.
5. Create the service, then open its **Settings** and **Integrations** tabs to finish routing.

A usable paging setup needs both an integration that can create the incident and an escalation policy with a resolvable target. A service without a policy supports manual assignment but does not automatically page through policy steps.

## Service fields

| Field                  | Purpose                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Name                   | Unique product or system name shown throughout OpsKnight.                                   |
| Description            | Human-readable responsibility and scope.                                                    |
| Region                 | Optional deployment or business region label.                                               |
| SLA tier               | Optional Platinum, Gold, Silver, Bronze, or Internal classification.                        |
| Owning team            | Team accountable for the service.                                                           |
| Escalation policy      | Policy used when a new incident needs paging.                                               |
| Acknowledgement target | Default minutes used for acknowledgement SLA calculations. The model default is 15 minutes. |
| Resolution target      | Default minutes used for resolution SLA calculations. The model default is 120 minutes.     |

The tier label does not by itself configure acknowledgement or resolution targets. The v1.4 service settings page does not expose the model's default target-minute fields, so do not treat changing the tier label as an SLA-target change.

## Understand service health

The service directory calculates a live health state from incidents:

| Health          | Calculation                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| **Operational** | No active incidents.                                                                      |
| **Degraded**    | One or more active incidents, with none classified as critical by the health calculation. |
| **Critical**    | At least one active critical incident.                                                    |

Resolved, snoozed, and suppressed incidents are excluded from the active count. This calculated display is distinct from the broader stored status values used by status-page configuration.

Use directory search and the team, health, tier, and sort controls to find a service. The service detail page shows active incidents, resolved history, and 30-day operational metrics. The **Dependencies** tab is visible but disabled in v1.4; do not rely on dependency mapping for routing or impact analysis.

## Configure ownership and escalation

Open **Service → Settings** and select:

- an owning team for accountability and filtering;
- an escalation policy for automated paging.

Policy changes apply immediately to new incidents. Existing incidents resolve the current policy as escalation advances, so review active incidents before changing or removing a target.

After saving, trigger a test event and verify the incident is attached to this service and the expected first policy target receives it.

## Add inbound integrations

Open **Service → Integrations** to add one or more supported monitoring sources. Each integration has its own generated routing key. Depending on the selected type, OpsKnight normalizes the provider payload into Events API actions and fields.

For an integration you can:

- copy its routing key;
- enable or disable it;
- rotate or clear its optional HMAC signature secret;
- delete it when it is no longer used.

Treat keys and signature secrets as credentials. Store them in the source system's secret manager, never in a repository or screenshot. Rotating or deleting an integration breaks senders that still use the previous value.

See the [integration directory](../integrations/README.md) for provider-specific payloads and verification steps.

## Configure service notifications

Service notifications are independent of escalation-step notifications. In **Service → Settings**, select channels from Slack, webhook, email, SMS, push, and WhatsApp, then choose which lifecycle events send service-level messages:

- incident triggered;
- incident acknowledged;
- incident resolved;
- SLA breach.

A selected channel still needs a valid workspace-level provider and any required recipient or service configuration. Test each channel before production. Use notification history and system logs to diagnose delivery failures.

### Slack and ChatOps

A service can use the active workspace Slack connection or a legacy incoming webhook/channel configuration. When ChatOps is enabled, it can inherit global war-room settings or override automatic channel creation and the video bridge with Jitsi, Zoom, Google Meet, none, or a custom URL.

See [Slack notifications](../integrations/communication/slack.md) and [Slack ChatOps](../integrations/communication/slack-chatops.md).

### Outbound webhooks

Service webhooks send lifecycle updates to external systems. Configure the endpoint, event selection, authentication/signing options exposed by the form, and enabled state. Use the built-in test before enabling it for real incidents. See [Custom webhooks](../integrations/custom/webhooks.md).

### Jira mapping

When workspace Jira is enabled, map the service to a project and configure:

- incident and action-item issue types;
- default labels and optional component;
- incident auto-creation and the eligible urgency levels;
- synchronization state.

If auto-create is enabled, select at least one urgency. Validate that the Jira token can access the project, issue types, and component. See [Jira](../integrations/issue-tracking/jira.md).

## SLA and incident history

The service page reports active incidents, total history, acknowledgement/resolution performance, and SLA compliance for the displayed 30-day window. Priority-specific SLA targets take precedence when configured; otherwise OpsKnight uses the service acknowledgement and resolution targets.

Snoozed and suppressed incidents are excluded from active impact. Review those queues separately so muting does not hide unfinished work.

## Put a service on a status page

Adding a service to a public status page is a separate administrator action. Status-page settings control display name, grouping, visibility, metrics, and privacy. Service ownership or a public incident does not automatically expose the service. See [Status page](status-page.md).

## Delete a service

Only an Admin can delete a service. Deletion is destructive and cascades through related service data, including incidents, alerts, and integrations.

Before deleting:

1. Confirm the exact service and incident count in the deletion dialog.
2. Resolve or transfer operational work and preserve any records required by policy.
3. Remove or reconfigure monitoring senders.
4. Export required evidence and confirm backup retention.

Do not use deletion as an archival workflow.

## Production-readiness check

- [ ] Name, description, region, tier, and owner are accurate.
- [ ] An escalation policy is attached and every target resolves.
- [ ] Each inbound integration creates the expected deduplicated incident.
- [ ] A responder receives and acknowledges a test page.
- [ ] Service-level notification events and channels are intentional.
- [ ] Slack, webhook, Jira, and war-room settings are tested if enabled.
- [ ] SLA targets and priority overrides reflect the service objective.
- [ ] Status-page inclusion and privacy are correct.

## Troubleshooting

### Incidents are attached to the wrong service

Verify the sender uses the integration key from this service. Integration names are descriptive; the key determines routing.

### No one is paged

Confirm a policy is attached, its targets are active, schedules have coverage, and notification providers are configured. Then inspect the incident timeline and notification history.

### Health looks wrong

Review active Open and Acknowledged incidents and confirm urgency/priority. Snoozed, suppressed, and resolved incidents do not count as active service impact.

### Jira creation fails

Check workspace Jira configuration, project key, issue type, component, token permissions, and auto-create urgency selection.

## Related topics

- [Incidents](incidents.md)
- [Teams](teams.md)
- [Escalation policies](escalation-policies.md)
- [Analytics](analytics.md)
- [Status page](status-page.md)
