---
title: Event Logs
description: Review incident lifecycle history and test Events API ingestion
order: 13
---

# Event Logs

The **Event Logs** page is a cross-incident stream of incident lifecycle events. It provides visibility across all triggered alerts, acknowledgements, escalations, and resolutions.

## Review lifecycle events

Open **Event Logs** from the main navigation (restricted to **Administrators**). The page displays incident events newest first in pages of 50.

### Interactive UI enhancements

- **Lifecycle Type Badges**:
  - 🔴 **TRIGGER**: Alert incoming / Incident opened _(Rose)_
  - 🟡 **ACKNOWLEDGE**: Responder assigned & acknowledged _(Amber)_
  - 🟢 **RESOLVE**: Incident resolved / Mitigated _(Emerald)_
  - 🟣 **ESCALATE**: Policy escalation triggered _(Purple)_
  - 🔵 **NOTE / SNOOZE**: Responder notes & timeline entries _(Blue / Slate)_
- **One-Click Event ID Copy**: Hover over the event identifier to copy the full UUID with instant clipboard feedback.
- **Deep Incident & Service Links**: Jump straight into the incident war room or service catalog from any event row.
- **Centralized Search & Filters**: Filter by event keyword, incident ID, or service name; export filtered tables directly to CSV.

## Send a test event from the UI

The built-in test console sends live mock payloads to test the [Events API](../api/events).

1. Open a service and select **Manage Integrations**.
2. Create or copy an enabled integration key for that service.
3. Open **Event Logs → Send Test Alert**.
4. Paste the integration key.
5. Choose `trigger` and keep the generated deduplication key.
6. Enter a summary and severity, then send the event.
7. Confirm the response is successful and open the resulting incident.
8. Send `acknowledge` with the same deduplication key.
9. Send `resolve` with the same deduplication key.
10. Confirm the incident and Event Logs reflect the full lifecycle.

The test form sends `source: OpsKnight-test-ui` and includes a timestamp in `custom_details`. Treat the integration key as a secret; do not paste a production key into screenshots or public channels.

## Deduplication boundary

The Events API uses the service and `dedup_key` to correlate repeated trigger, acknowledge, and resolve actions. Vendor integrations derive their deduplication key from vendor-specific identifiers. See the relevant [integration runbook](../integrations) for its mapping.

## Troubleshooting

| Problem                                         | Check                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Test returns 401                                | Confirm the header uses an enabled service integration key, not an arbitrary API key value.                                 |
| Test returns 404                                | The integration key may have been deleted or may no longer identify a service.                                              |
| Acknowledge/resolve cannot find the incident    | Reuse the exact deduplication key and integration key from the trigger request.                                             |
| The incident exists but no off-box page arrived | Check the service policy, current schedule coverage, user preferences, provider settings, and notification history.         |
| An old event is missing                         | Clear filters and move through result pages. Confirm the configured Audit & Event History retention period has not expired. |

## Related guides

- [Events API](../api/events)
- [Incidents](./incidents)
- [Integrations](../integrations)
- [Audit logs](../administration/audit-logs)
- [Notifications](../administration/notifications)
