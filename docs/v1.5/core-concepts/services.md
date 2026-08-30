---
title: Services
description: Model service ownership, incident routing, health, SLAs, notifications, and integrations.
order: 3
---

# Services

A service is the primary routing, accountability, and reporting boundary for incidents in OpsKnight. It ties together an owning team, escalation policy, inbound alert monitoring integrations, notification behavior, SLA performance targets, Jira issue synchronization, Slack ChatOps war-room coordination, public status-page visibility, and incident history.

```text
Alert Sources (CloudWatch, Datadog, Prometheus, Webhooks)
  → Service Ingest Integration (Routing Key + Optional HMAC Secret)
  → Service Incident Creation & Deduplication
  → Attached Escalation Policy (Users, Teams, Schedules)
  → Service Notifications (Slack, Email, SMS, Push, WhatsApp) & ChatOps War Room
```

## Permissions

| Role                | Capabilities                                                                                                                                      |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Signed-in Users** | View service directory, service detail pages, incident stream, attached policy overview, and health metrics.                                      |
| **Responders**      | Create new services, edit service metadata, manage inbound alert integrations, and configure notification mappings.                               |
| **Admins**          | Full control over services, including changing owning teams, escalation policy attachment, Jira mapping, ChatOps overrides, and service deletion. |

---

## Service Directory & Health

The **Service Directory** (`/services`) provides an operational command overview of all services in your organization.

### Health Calculation

OpsKnight continuously calculates a live health indicator for each service based on active incidents:

| Health Status   | Badge                 | Calculation Rule                                                |
| :-------------- | :-------------------- | :-------------------------------------------------------------- |
| **Operational** | `Operational` (Green) | No active (Open or Acknowledged) incidents.                     |
| **Degraded**    | `Degraded` (Yellow)   | One or more active incidents, none classified as critical.      |
| **Critical**    | `Critical` (Red)      | At least one active incident with critical urgency or severity. |

> [!NOTE]
> Snoozed, suppressed, and resolved incidents are excluded from the active health calculation.

### Directory Features

- **Search & Filtering**: Filter services by name, description, owning team, SLA tier, and real-time health status.
- **Hero Metrics Banner**: Displays aggregate service totals and health breakdowns across your organization.
- **Empty States**: Standardized empty states guide users when no services match selected filters or when creating a first service.

---

## Redesigned Service Workspace

The service detail page (`/services/[id]`) provides a centralized, tabbed workspace with a glassmorphic **DetailHeroBanner** and URL-synchronized navigation (`?tab=...`).

### Hero Header & 4-Stat Capsule

The top hero banner displays the service name, description, owning team, SLA tier, primary region, and live health status badge, accompanied by a 4-stat operational capsule:

1. **Availability (30d)**: Rolling 30-day percentage uptime calculated from incident downtime.
2. **MTTR**: Mean Time to Resolution for incidents in the past 30 days.
3. **Incidents / mo**: Average monthly incident frequency.
4. **SLA Compliance**: Percentage of incidents meeting configured acknowledgement and resolution targets.

```text
+-------------------------------------------------------------------------------+
| Web API Service   [Operational]   Team: Platform Core   Tier: Platinum   US-East |
| +-----------------+ +-----------------+ +-----------------+ +-----------------+ |
| | Availability:   | | MTTR:           | | Incidents/mo:   | | SLA Compliance: | |
| |     99.98%      | |      14m        | |       1.2       | |      98.5%      | |
| +-----------------+ +-----------------+ +-----------------+ +-----------------+ |
+-------------------------------------------------------------------------------+
| [ Incidents (3) ]   [ Escalation Policy ]   [ Integrations (2) ]   [ Settings ] |
+-------------------------------------------------------------------------------+
```

---

## Tab 1: Incidents

The **Incidents** tab provides the operational stream of current and past incidents for this service:

- **Active Incidents**: Real-time view of Open and Acknowledged incidents requiring response.
- **Incident History**: Paginated log of resolved incidents with duration, assigned responders, and severity tags.
- **Quick Actions**: One-click navigation to create a new incident or view postmortems.
- **Empty State**: Displays an informative `<EmptyState />` when the service is fully operational with zero active incidents.

---

## Tab 2: Escalation Policy

The **Escalation Policy** tab renders a direct visual representation of the escalation ladder attached to the service:

- **Attached Policy Header**: Displays the policy name, description, and an action link to modify the policy in the Escalation Policy editor.
- **Ordered Step Ladder**: Visualizes the sequential escalation steps, showing:
  - Step order index and delay timer (e.g. `Step 1 (Immediate)`, `Step 2 (Wait 5m)`).
  - Target responder type with user avatar, team member count, or on-call schedule link.
  - Clear indicator if no policy is currently attached (manual assignment mode).

---

## Tab 3: Ingest Integrations & Webhooks

The **Integrations & Webhooks** tab manages inbound monitoring endpoints that automatically ingest alerts from third-party tools.

### Integration Cards

Each configured integration is presented as a rich card with:

- **Provider Brand Identity**: Official brand icon and distinct background color (e.g. AWS CloudWatch, Datadog, Grafana, Prometheus, Sentry, GitHub).
- **Metadata Grid**: Provider **Type** and functional **Category** (e.g. `Monitoring & APM`, `Cloud & Infrastructure`, `CI/CD & Version Control`, `Uptime & Status`).
- **Creation Timestamp & Status Toggle**: Live enable/disable switch allowing responders to pause alert intake without deleting the configuration.
- **Delete Action**: Clean removal dialog for decommissioned endpoints.

### Ingest Views by Integration Type

#### 1. Events API v2 (`EVENTS_API_V2`)

- **Webhook Ingest URL**: Complete, copyable endpoint URL (`/api/events`) for standard Events API v2 payloads.
- **Routing / API Key**: Copyable unique routing key used in standard OpsKnight Events API v2 payloads.
- **Quick Test Snippet**: Ready-to-use `curl` code sample prefilled with the endpoint and authorization header.

#### 2. Provider-Native Webhooks (CloudWatch, Datadog, Prometheus, Grafana, etc.)

- **Webhook Ingest URL**: Complete, copyable endpoint URL containing the integration ID and key parameter.
- **Optional Signature Secret Control**: Integrated HMAC signature verification manager.

### Optional Signature Secret Management

In OpsKnight, webhook signature verification is **completely optional**:

> [!IMPORTANT]
> **Signature verification is optional by default**. If no signature secret is generated, OpsKnight authenticates incoming webhooks using the routing key in the request header or URL. Senders that do not support HMAC signing will function seamlessly.

```text
[ Unconfigured State (Default) ]
Signature Secret: (optional)
[ No secret configured (Signature verification disabled) ]  [ Generate Secret ]

[ Configured State (HMAC Enforced) ]
Signature Secret: (optional)                  [ Verification Active (Green) ]
[ •••••••••••••••••••••••••••••••• ]  [ Copy ]  [ Rotate ]  [ Remove / Disable ]
```

- **Unconfigured State**: Displays `"No secret configured (Signature verification disabled)"` with a `"Generate Secret"` action.
- **Generating a Secret**: Click `"Generate Secret"` to create a cryptographically random 32-byte hex HMAC secret. OpsKnight immediately enforces HMAC-SHA256 signature verification on incoming webhooks for that integration.
- **Rotating a Secret**: Click the `Rotate` icon to generate a new secret. Note that external webhook senders must be updated with the new secret immediately.
- **Disabling / Removing Secret**: Click the `Trash` icon to clear the secret. Webhooks will immediately revert to standard key-based authentication without requiring HMAC headers.

---

## Tab 4: Service Settings & ChatOps

The **Service Settings** tab consolidates all administrative and integration configurations for the service:

### 1. General Service Metadata

- **Service Name**: Unique organizational identifier.
- **Description**: Scope and responsibilities.
- **Region**: Deployment or business region (e.g. `us-east-1`, `eu-west-1`, `global`).
- **SLA Tier**: `Platinum`, `Gold`, `Silver`, `Bronze`, or `Internal`.
- **Owning Team**: Accountable team for incident filtering and ownership.
- **Escalation Policy**: Attached automated paging policy.

### 2. Service Notifications Mapping

Configure service-level notifications across channels independent of individual responder paging:

- **Available Channels**: Slack, Outbound Webhooks, Email, SMS, Web Push, and WhatsApp.
- **Lifecycle Events**: Triggered, Acknowledged, Resolved, and SLA Breached.

### 3. ChatOps War Room Overrides

- **Slack War Room**: Choose between workspace default war-room settings or service-specific channel generation.
- **Video Bridge Provider**: Auto-create video conference links using **Jitsi Meet**, **Zoom**, **Google Meet**, **None**, or a custom meeting URL template.

### 4. Jira Service Mapping

- **Project Key**: Target Jira project for automated issue creation.
- **Issue Types**: Incident issue type (e.g. `Bug`, `Incident`) and Action Item issue type (e.g. `Task`).
- **Auto-Creation Rules**: Trigger automated Jira ticket creation for selected urgency levels (`HIGH`, `MEDIUM`, `LOW`).

### 5. Danger Zone (Delete Service)

- Deleting a service is permanent and cascades to associated alerts, incident links, and integration endpoints.
- **Verified Deletion**: Uses the accessible `DeleteConfirmDialog`, requiring the user to type the exact service name before unlocking the delete button.

---

## Production Readiness Checklist

Before putting a new service into production, verify the following:

- [ ] **Name & Ownership**: Service name is unique and assigned to the correct accountable team.
- [ ] **Escalation Policy**: An active escalation policy is attached with valid, resolving user, team, or schedule targets.
- [ ] **Ingest Integration**: Monitoring integrations are created, and a test alert successfully triggers a deduplicated incident.
- [ ] **Signature Secret (if required)**: If the upstream provider supports webhook signing, generate an optional HMAC secret and configure it upstream.
- [ ] **ChatOps & War Room**: Slack channel mapping and video bridge settings are tested.
- [ ] **Notification Mappings**: Service-level notification events and recipient channels are verified.
- [ ] **Jira Sync**: Project mapping and issue types are validated if Jira synchronization is enabled.
- [ ] **Status Page**: Service is added to the public or private status page if customer-facing visibility is desired.

---

## Related Topics

- [How Integrations Work](integrations.md)
- [Inbound Webhook Reference](../integrations/inbound-webhook-reference.md)
- [Escalation Policies](escalation-policies.md)
- [Teams & Ownership](teams.md)
- [Incident Management](incidents.md)
- [Analytics & SLA](analytics.md)
