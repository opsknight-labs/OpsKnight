---
order: 2
title: Incidents API
description: List, create, read, and update the incident fields published by OpsKnight v1.4.
---

# Incidents API

The v1.4 Incidents API has four API-key operations:

| Method and path             | Scope             | Purpose                                                        |
| --------------------------- | ----------------- | -------------------------------------------------------------- |
| `GET /api/incidents`        | `incidents:read`  | List newest incidents visible to the key owner.                |
| `POST /api/incidents`       | `incidents:write` | Create one manual incident and start its routing side effects. |
| `GET /api/incidents/{id}`   | `incidents:read`  | Read one visible incident.                                     |
| `PATCH /api/incidents/{id}` | `incidents:write` | Change status, urgency, and/or assignee.                       |

There are no published API-key operations for delete, merge, bulk update, notes, timeline, incident export, telemetry context, or custom fields. Some UI-session routes exist for UI workflows; they are not part of this API contract.

## Authentication and access

```http
Authorization: Bearer ok_REDACTED
```

The key is tied to its creator:

- `ADMIN` and `RESPONDER` key owners can access incidents across the installation.
- A `USER` key owner can access an incident when assigned directly or when the incident's service belongs to one of their teams.
- Create access for a `USER` similarly requires the destination service to belong to one of their teams.

A valid key with an inaccessible resource returns 403. Missing/invalid/revoked keys return 401.

## List incidents

```http
GET /api/incidents?limit=50
```

`limit` defaults to 50, invalid/non-positive values fall back to 50, and the maximum is 200. No other list filter, sort, cursor, `offset`, total count, or `hasMore` field is published in v1.4. Results are newest first.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $OPSKNIGHT_API_KEY" \
  "https://ops.example.com/api/incidents?limit=25"
```

Response:

```json
{
  "incidents": [
    {
      "id": "clx...",
      "title": "Database connection pool exhausted",
      "status": "OPEN",
      "urgency": "HIGH",
      "service": { "id": "clx...", "name": "Checkout API" },
      "assignee": null,
      "createdAt": "2026-08-21T10:30:00.000Z"
    }
  ]
}
```

Incident objects include the incident's persisted scalar fields plus the selected service (`id`, `name`) and assignee (`id`, `name`, `email`). Consumers should ignore fields they do not use.

The response can be privately cached for five seconds with a stale-while-revalidate window; do not assume a list read is an instantaneous coordination primitive.

## Get one incident

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $OPSKNIGHT_API_KEY" \
  "https://ops.example.com/api/incidents/INCIDENT_ID"
```

Response wrapper:

```json
{
  "incident": {
    "id": "INCIDENT_ID",
    "title": "Database connection pool exhausted",
    "description": "Primary pool has no available connections",
    "status": "OPEN",
    "urgency": "HIGH",
    "priority": "P1",
    "service": { "id": "SERVICE_ID", "name": "Checkout API" },
    "assignee": null,
    "createdAt": "2026-08-21T10:30:00.000Z",
    "acknowledgedAt": null,
    "resolvedAt": null
  }
}
```

HTTP 404 means the incident ID does not exist. HTTP 403 means it exists but the key owner is not authorized to access it.

## Create an incident

```http
POST /api/incidents
Content-Type: application/json
```

| Field         | Required | Validation                                                                                   |
| ------------- | :------: | -------------------------------------------------------------------------------------------- |
| `title`       |   Yes    | Trimmed string, 1–500 characters.                                                            |
| `description` |    No    | Trimmed string up to 10,000 characters or `null`.                                            |
| `serviceId`   |   Yes    | Existing service ID accessible to the key owner.                                             |
| `urgency`     |   Yes    | `LOW`, `MEDIUM`, or `HIGH`.                                                                  |
| `priority`    |    No    | Trimmed string up to 20 characters or `null`; use the UI's `P1`–`P5` values for consistency. |

Other supplied fields such as assignee, team, deduplication key, suppression flag, custom details, or links are not part of this create contract and are not accepted as create behavior.

```bash
curl --fail-with-body \
  -X POST "https://ops.example.com/api/incidents" \
  -H "Authorization: Bearer $OPSKNIGHT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Database connection pool exhausted",
    "description": "Primary pool has no available connections",
    "serviceId": "SERVICE_ID",
    "urgency": "HIGH",
    "priority": "P1"
  }'
```

The response is HTTP 201 with `{ "incident": ... }`.

Creation stores an `OPEN` incident, executes its escalation policy, triggers applicable service/user notifications, status-page webhooks/subscriber mail, and qualifying Slack ChatOps war-room creation. Several outbound actions are best-effort or asynchronous; HTTP 201 proves incident creation, not delivery by every downstream provider. Verify the incident timeline and provider/history views.

This endpoint does not accept a deduplication key. For retriable alert lifecycles, use the [Events API](./events).

## Update an incident

```http
PATCH /api/incidents/{id}
Content-Type: application/json
```

At least one supported field is required:

| Field        | Values                                                      | Behavior                                           |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------- |
| `status`     | `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `SNOOZED`, `SUPPRESSED` | Changes lifecycle/escalation state and timestamps. |
| `urgency`    | `LOW`, `MEDIUM`, `HIGH`                                     | Updates urgency and records an event when changed. |
| `assigneeId` | User ID                                                     | Assigns the incident and records an event.         |

Title, description, priority, teams, snooze duration, resolution note, and custom details are not accepted by this API-key PATCH operation.

### Acknowledge

```bash
curl --fail-with-body \
  -X PATCH "https://ops.example.com/api/incidents/INCIDENT_ID" \
  -H "Authorization: Bearer $OPSKNIGHT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED"}'
```

Acknowledging sets `acknowledgedAt` if it was not already set and completes escalation.

### Resolve

```bash
curl --fail-with-body \
  -X PATCH "https://ops.example.com/api/incidents/INCIDENT_ID" \
  -H "Authorization: Bearer $OPSKNIGHT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"RESOLVED"}'
```

Resolving sets `resolvedAt` if absent and completes escalation.

### Snooze or suppress

```json
{ "status": "SNOOZED" }
```

or:

```json
{ "status": "SUPPRESSED" }
```

Both pause escalation and clear the next escalation time. This API operation does not accept a snooze duration, so use the UI when a timed snooze is required.

### Reopen

```json
{ "status": "OPEN" }
```

Reopening from acknowledged, resolved, snoozed, or suppressed resumes escalation. From resolved, it clears resolution/acknowledgement timing and restarts from escalation step zero; from acknowledged it schedules using the current step delay; from snoozed/suppressed it becomes eligible immediately.

### Assign

```json
{ "assigneeId": "USER_ID" }
```

The schema accepts `null`, but the current v1.4 PATCH implementation treats null as “field omitted”; API-key clients cannot reliably unassign with this operation. Use the UI to unassign.

The response is HTTP 200 with `{ "incident": ... }`. Status changes can send service notifications and status-page subscriber/webhook updates. As with create, success does not prove downstream delivery.

## Rate limiting

Each API key and operation class (`get`, `post`, or `patch`) is limited to 60 requests per 60 seconds. A rejected request returns HTTP 429 and `Retry-After` in seconds. List and detail reads share the same `get` bucket.

```json
{ "error": "Rate limit exceeded." }
```

See [Rate limiting](./rate-limiting) for storage and client guidance.

## Error handling

| Status | Meaning                                                                     |
| -----: | --------------------------------------------------------------------------- |
|    400 | Invalid JSON/body, unsupported value, or no supported patch field.          |
|    401 | Missing, invalid, or revoked key; or key owner no longer exists.            |
|    403 | Required scope missing or the key owner cannot access the incident/service. |
|    404 | Incident or service not found.                                              |
|    429 | Operation bucket exhausted; honor `Retry-After`.                            |
|    500 | Unexpected server/database failure; investigate before retrying a create.   |

## Production checklist

- [ ] A dedicated least-privilege user owns the key.
- [ ] The key has only `incidents:read` and/or `incidents:write` as required.
- [ ] Create automation uses the Events API when deduplication/retry safety is needed.
- [ ] Clients accept route-specific response wrappers and ignore unused fields.
- [ ] 429 handling is bounded and honors `Retry-After`.
- [ ] A non-production incident validates routing and downstream side effects.
- [ ] Token rotation and revocation are tested.

## Related topics

- [API Reference](./README)
- [Events API](./events)
- [Rate limiting](./rate-limiting)
- [Incident response](../core-concepts/incidents)
