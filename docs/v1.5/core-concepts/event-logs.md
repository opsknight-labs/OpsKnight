---
title: Event Logs
description: Review incident lifecycle history and test Events API ingestion
order: 13
---

# Event Logs

The **Event Logs** page is a cross-incident view of incident lifecycle events. It is different from the raw monitoring payload stored as an alert and different from the administration [Audit Log](../administration/audit-logs), which records security and configuration activity.

## Review lifecycle events

Open **Event Logs** from the main navigation (restricted to **Administrators**; hidden from Users and Responders). The page displays incident events newest first in pages of 50, so history is not limited to an initial 200-record window.

Each row contains the timestamp in your configured time zone, a short incident identifier and title, the incident's service, and the lifecycle message. Select the incident identifier to open the full incident timeline.

Typical messages appear after an incident is triggered, acknowledged, escalated, reassigned, commented on, reopened, automatically resolved, or manually resolved. Older records may not have a structured event type, so the human-readable message remains important.

Use the search field to find event messages, incident IDs or titles, and service names. You can also filter by service and move between result pages. **Export CSV** exports the currently visible page; use an operator-controlled database export for a complete large-range extract. Use the incident page when you need the complete timeline for one incident.

## Send a test event from the UI

The test page sends the same request documented in the [Events API](../api/events).

1. Open a service and select **Manage Integrations**.
2. Create or copy an enabled integration key for that service.
3. Open **Event Logs → Send Test Alert**.
4. Paste the integration key.
5. Choose `trigger` and keep the generated deduplication key.
6. Enter a summary and severity, then send the event.
7. Confirm the response is successful and open the resulting incident.
8. Send `acknowledge` with the same deduplication key.
9. Send `resolve` with the same deduplication key.
10. Confirm the incident and Event Logs reflect the lifecycle.

The test form sends `source: OpsKnight-test-ui` and includes a timestamp in `custom_details`. Treat the integration key as a secret; do not paste a production key into screenshots or support messages.

## Deduplication boundary

The Events API uses the service and `dedup_key` to correlate repeated trigger, acknowledge, and resolve actions. Vendor integrations can derive their deduplication key from vendor-specific identifiers instead. See the relevant [integration runbook](../integrations) for its mapping.

## Troubleshooting

| Problem                                         | Check                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Test returns 401                                | Confirm the header uses an enabled service integration key, not an arbitrary API key value.                         |
| Test returns 404                                | The integration key may have been deleted or may no longer identify a service.                                      |
| Acknowledge/resolve cannot find the incident    | Reuse the exact deduplication key and integration key from the trigger request.                                     |
| The incident exists but no off-box page arrived | Check the service policy, current schedule coverage, user preferences, provider settings, and notification history. |
| An old event is missing                         | Clear filters and move through result pages. Confirm the configured Audit & Event History retention period has not expired. |

## Related guides

- [Events API](../api/events)
- [Incidents](./incidents)
- [Integrations](../integrations)
- [Audit logs](../administration/audit-logs)
- [Notifications](../administration/notifications)
