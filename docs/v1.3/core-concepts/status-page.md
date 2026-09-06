---
order: 9
title: Status Page
description: Comprehensive guide to configuring and managing your public status page
---

# Status Page

The Status Page is your public-facing communication hub for service health, incidents, and maintenance. It keeps customers and stakeholders informed with real-time updates, reducing support inquiries during incidents.

<!-- placeholder:status-page-overview -->
<!-- Add: Screenshot of a live status page showing services and incidents -->

---

## Why You Need a Status Page

| Without Status Page                                | With Status Page                        |
| -------------------------------------------------- | --------------------------------------- |
| Customers flood support with "Is it down?" tickets | Customers self-serve status information |
| No transparency during outages                     | Real-time incident updates build trust  |
| Manual status communication                        | Automated status from incident data     |
| No historical uptime data                          | 90-day uptime metrics visible           |

---

## Accessing Your Status Page

- **Public URL**: `https://your-opsknight.com/status`
- **Mobile URL**: `https://your-opsknight.com/m/status`
- **JSON API**: `https://your-opsknight.com/api/status`
- **RSS Feed**: `https://your-opsknight.com/api/status/rss`

---

## Configuring the Status Page

Navigate to **Settings → Status Page** to configure all options.

### Basic Settings

| Setting               | Description                             | Required |
| --------------------- | --------------------------------------- | -------- |
| **Name**              | Status page title (e.g., "Acme Status") | Yes      |
| **Organization Name** | Brand name used in emails               | Yes      |
| **Enabled**           | Toggle public visibility                | Yes      |
| **Footer Text**       | Custom footer message                   | No       |
| **Contact Email**     | Support contact email                   | No       |
| **Contact URL**       | Link to support portal                  | No       |

### Display Options

| Setting                 | Default | Description                     |
| ----------------------- | ------- | ------------------------------- |
| **Show Services**       | `true`  | Display service health list     |
| **Show Incidents**      | `true`  | Display incident history        |
| **Show Metrics**        | `true`  | Display uptime percentages      |
| **Show Subscribe**      | `true`  | Show email subscription form    |
| **Show Region Heatmap** | `false` | Visual service health by region |
| **Show Changelog**      | `false` | Recent updates feed             |

---

## Branding & Themes

OpsKnight provides **40+ professional themes** to match your brand identity.

### Theme Categories

**Professional Themes**

- Corporate Blue, Enterprise Gray, Slate Executive
- Navy Silver, Indigo Mint, Boardroom Slate
- Capital Ivory, Steel Harbor, Summit Teal

**Colorful Themes**

- Aurora Bright, Redline, Ocean Glass, Sunset Bloom
- Emerald Dawn, Royal Blueprint, Citrus Pop
- Lavender Mist, Coral Reef, Neon Lime, Retro Pop

**Dark Themes**

- Midnight Neon, Arctic Night, Desert Night

### Custom Branding

| Setting           | Description                                     |
| ----------------- | ----------------------------------------------- |
| **Logo**          | Upload your company logo (PNG, SVG)             |
| **Primary Color** | Main accent color (hex)                         |
| **Text Color**    | Text color override                             |
| **Custom CSS**    | Inject custom styles for advanced customization |

### Layout Options

| Layout      | Description                               |
| ----------- | ----------------------------------------- |
| **Default** | Standard width, balanced spacing          |
| **Wide**    | Full-width layout for large service lists |
| **Compact** | Dense layout, more info above the fold    |

### Toggle Elements

- Header visibility (on/off)
- Footer visibility (on/off)
- RSS feed link (on/off)
- API JSON link (on/off)
- Uptime export links (on/off)
- Auto-refresh interval (configurable)

---

## Privacy Settings

Control what information is publicly visible with fine-grained privacy controls.

### Privacy Presets

| Mode           | Description                            | Use Case                      |
| -------------- | -------------------------------------- | ----------------------------- |
| **PUBLIC**     | Show all information                   | Default, maximum transparency |
| **RESTRICTED** | Hide descriptions, show general status | Balance of info and privacy   |
| **PRIVATE**    | Minimal information, basic status only | Sensitive environments        |
| **CUSTOM**     | Mix-and-match individual settings      | Tailored requirements         |

### Individual Privacy Controls

#### Incident Visibility

| Setting                    | Default (Public) | Description                 |
| -------------------------- | ---------------- | --------------------------- |
| `showIncidentDetails`      | ✅               | Full incident information   |
| `showIncidentTitles`       | ✅               | Incident titles             |
| `showIncidentDescriptions` | ✅               | Incident descriptions       |
| `showIncidentTimestamps`   | ✅               | When incidents occurred     |
| `showIncidentUrgency`      | ✅               | Urgency levels              |
| `showAffectedServices`     | ✅               | Which services are impacted |
| `showIncidentAssignees`    | ❌               | Who is working on it        |

#### Service Visibility

| Setting                   | Default (Public) | Description              |
| ------------------------- | ---------------- | ------------------------ |
| `showServiceMetrics`      | ✅               | Uptime percentages       |
| `showServiceDescriptions` | ✅               | Service descriptions     |
| `showServiceRegions`      | ❌               | Geographic regions       |
| `showServicesByRegion`    | ❌               | Group services by region |
| `showServiceOwners`       | ❌               | Team ownership           |
| `showServiceSlaTier`      | ❌               | SLA tier badges          |

#### Advanced Visibility

| Setting                  | Default | Description            |
| ------------------------ | ------- | ---------------------- |
| `showTeamInformation`    | ❌      | Team details           |
| `showCustomFields`       | ❌      | Custom field values    |
| `showUptimeHistory`      | ✅      | Historical uptime data |
| `showRecentIncidents`    | ✅      | Recent incident list   |
| `showPostIncidentReview` | ❌      | Link to postmortems    |
| `showRegionHeatmap`      | ❌      | Visual region status   |

### Data Limits

| Setting               | Default | Description               |
| --------------------- | ------- | ------------------------- |
| `maxIncidentsToShow`  | 50      | Maximum incidents on page |
| `incidentHistoryDays` | 90      | Days of incident history  |
| `dataRetentionDays`   | -       | Data retention period     |

---

## Service Display

### Adding Services to Status Page

1. Go to **Settings → Status Page → Services**
2. Click **Add Service**
3. Select services to display
4. Configure display options per service

### Per-Service Options

| Option           | Description                                    |
| ---------------- | ---------------------------------------------- |
| **Display Name** | Override the service name for public display   |
| **Order**        | Position in the service list (drag to reorder) |
| **Show on Page** | Toggle visibility per service                  |

### Service Status Indicators

| Status                   | Indicator | Meaning                        |
| ------------------------ | --------- | ------------------------------ |
| **Operational**          | 🟢 Green  | All systems normal             |
| **Degraded Performance** | 🟡 Yellow | Partial issues, service usable |
| **Partial Outage**       | 🟠 Orange | Some components unavailable    |
| **Major Outage**         | 🔴 Red    | Service completely unavailable |
| **Maintenance**          | 🔵 Blue   | Planned downtime               |

Status is automatically calculated from active incidents affecting each service.

---

## Uptime Metrics

The status page displays uptime percentages and SLA compliance for each service.

### Metrics Displayed

| Metric               | Description                               |
| -------------------- | ----------------------------------------- |
| **30-Day Uptime**    | Availability percentage over last 30 days |
| **90-Day Uptime**    | Availability percentage over last 90 days |
| **Downtime Minutes** | Total downtime in the period              |
| **Incident Count**   | Number of incidents in the period         |

### SLA Badges

| Badge         | Threshold (Default) | Meaning               |
| ------------- | ------------------- | --------------------- |
| **Excellent** | ≥ 99.9%             | Exceeding SLA targets |
| **Good**      | ≥ 99.0%             | Meeting SLA targets   |
| **Below SLA** | < 99.0%             | Missing SLA targets   |

### Configuring Thresholds

| Setting                    | Default | Description                |
| -------------------------- | ------- | -------------------------- |
| `uptimeExcellentThreshold` | 99.9    | Percentage for "Excellent" |
| `uptimeGoodThreshold`      | 99.0    | Percentage for "Good"      |

### Uptime Export

Export uptime data for reporting:

- **CSV Format**: `/api/status/uptime-export?format=csv`
- **PDF Format**: `/api/status/uptime-export?format=pdf`

---

## Announcements

Communicate proactively with scheduled maintenance and general updates.

### Creating an Announcement

1. Go to **Settings → Status Page → Announcements**
2. Click **Create Announcement**
3. Fill in the details:
   - **Title**: Announcement headline
   - **Message**: Detailed content (supports Markdown)
   - **Type**: Category of announcement
   - **Start Date**: When to show
   - **End Date**: When to hide (optional)
   - **Affected Services**: Services impacted

### Announcement Types

| Type            | Color  | Use Case                               |
| --------------- | ------ | -------------------------------------- |
| **INFO**        | Gray   | General updates, feature announcements |
| **WARNING**     | Orange | Potential issues, deprecations         |
| **MAINTENANCE** | Blue   | Scheduled maintenance windows          |
| **INCIDENT**    | Red    | Active incident communication          |
| **UPDATE**      | Green  | Improvements, resolved items           |

### Scheduling Maintenance

For planned maintenance:

1. Create announcement with type **MAINTENANCE**
2. Set **Start Date** to maintenance start time
3. Set **End Date** to expected completion
4. Select **Affected Services**
5. Optionally link to a related incident

The announcement shows:

- "Scheduled" badge before start time
- "In Progress" during the maintenance window
- Auto-hides after end time

---

## Email Subscriptions

Allow users to subscribe for status updates via email.

### How It Works

1. User enters email on status page
2. Verification email sent (prevents spam)
3. User clicks verification link
4. Subscribed users receive notifications for:
   - New incidents
   - Incident updates
   - Incident resolutions
   - Scheduled maintenance

### Subscription Settings

| Setting            | Description                         |
| ------------------ | ----------------------------------- |
| **Show Subscribe** | Toggle subscription form visibility |
| **Email Provider** | Resend, SendGrid, or SMTP           |

### Rate Limiting

Subscriptions are rate-limited to prevent abuse:

- **10 requests per IP** per minute
- **3 requests per email** per minute

### Managing Subscribers

View and manage subscribers in **Settings → Status Page → Subscribers**:

- See all verified subscribers
- View subscription date
- Remove subscribers if needed

### Unsubscribe Process

- Every email includes an unsubscribe link
- Uses secure token (no login required)
- Re-subscription is supported

---

## Webhooks (Outbound)

Send status page events to external systems.

### Creating a Webhook

1. Go to **Settings → Status Page → Webhooks**
2. Click **Add Webhook**
3. Configure:
   - **URL**: Endpoint to receive events
   - **Secret**: HMAC signing secret (optional but recommended)
   - **Events**: Which events to send

### Webhook Events

| Event                   | Trigger                                     |
| ----------------------- | ------------------------------------------- |
| `incident.created`      | New incident affecting status page services |
| `incident.updated`      | Incident status or details changed          |
| `incident.resolved`     | Incident marked resolved                    |
| `status.changed`        | Overall status changed                      |
| `maintenance.scheduled` | New maintenance announced                   |

### Webhook Payload

```json
{
  "event": "incident.created",
  "timestamp": "2024-01-23T10:30:00Z",
  "data": {
    "incident": {
      "id": "inc_abc123",
      "title": "API Latency Elevated",
      "status": "OPEN",
      "urgency": "HIGH"
    },
    "affected_services": ["api-gateway", "payment-api"],
    "status_page": {
      "id": "sp_xyz",
      "name": "Acme Status"
    }
  }
}
```

### Signature Verification

If a secret is configured, webhooks include an HMAC-SHA256 signature:

```
X-Webhook-Signature: sha256=abc123def456...
```

Verify by computing HMAC of the raw request body using your secret.

### Testing Webhooks

Use the **Test** button to send a sample event to your endpoint.

---

## API Access

### Public Status API

**Endpoint**: `GET /api/status`

Returns current status without authentication:

```json
{
  "status": "operational",
  "services": [
    {
      "name": "API Gateway",
      "status": "operational",
      "uptime_30d": 99.95,
      "uptime_90d": 99.87
    }
  ],
  "active_incidents": [],
  "scheduled_maintenance": []
}
```

### API Tokens

For protected status pages or programmatic access:

1. Go to **Settings → Status Page → API Tokens**
2. Click **Create Token**
3. Copy the token (shown only once)

Use in requests:

```
Authorization: Bearer <token>
```

### API Rate Limiting

| Setting                     | Default     | Description          |
| --------------------------- | ----------- | -------------------- |
| `statusApiRateLimitEnabled` | `false`     | Enable rate limiting |
| Rate limit                  | 120 req/60s | Requests per minute  |

### Requiring Authentication

Set `requireAuth: true` to gate the status page behind authentication.

Options:

- OpsKnight login
- SSO provider (via `authProvider` setting)

---

## RSS Feed

Subscribe to status updates via RSS:

**URL**: `/api/status/rss`

The feed includes:

- Active incidents
- Recent updates
- Scheduled maintenance

Compatible with:

- Slack RSS integration
- Microsoft Teams connectors
- RSS readers
- Monitoring tools

---

## Custom Domain

Host your status page on a custom domain (e.g., `status.yourcompany.com`).

### Configuration

1. Set **Custom Domain** in status page settings
2. Configure DNS:
   - **CNAME**: Point `status.yourcompany.com` to your OpsKnight instance
3. Configure SSL certificate for the custom domain

### Subdomain Option

Alternatively, use a subdomain of your OpsKnight installation:

- Setting: `subdomain`
- Result: `yoursubdomain.opsknight-instance.com/status`

---

## Mobile Status Page

A mobile-optimized version is available at `/m/status`:

- Touch-friendly interface
- Optimized for small screens
- Same data as desktop version
- PWA-compatible

---

## Best Practices

### Communication

- **Be proactive**: Post updates before customers notice
- **Be specific**: "API response times elevated" not "Issues"
- **Be honest**: Acknowledge impact, don't minimize
- **Be timely**: Update every 15-30 minutes during incidents

### Incident Phases

Use consistent phases in updates:

1. **Investigating** — Aware of issue, determining scope
2. **Identified** — Root cause found, working on fix
3. **Monitoring** — Fix deployed, watching for recurrence
4. **Resolved** — Issue fully resolved

### Maintenance Planning

- Schedule during low-traffic periods
- Announce 24-72 hours in advance
- Include expected duration
- Send reminder 1 hour before

### Privacy Considerations

- Don't expose internal service names
- Use customer-facing display names
- Hide team/assignee info if sensitive
- Consider RESTRICTED mode for B2B

---

## Related Topics

- [Services](./services) — Service configuration
- [Incidents](./incidents) — Incident management
- [Postmortems](./postmortems) — Post-incident reviews
- [Notifications](../administration/notifications) — Email configuration
