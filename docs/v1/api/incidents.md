---
order: 2
title: Incidents API
description: Create, list, update, and manage incidents programmatically
---

# Incidents API

The Incidents API provides full control over incidents in OpsKnight. Use it to list, create, update, and manage incidents from your own tools and automation.

---

## Overview

The Incidents API supports:

- Listing and filtering incidents
- Creating manual incidents
- Updating incident status, urgency, and assignee
- Adding notes and timeline events
- Merging related incidents
- Retrieving incident history

---

## Authentication

All endpoints require authentication via API key:

```http
Authorization: Bearer YOUR_API_KEY
```

### Required Scopes

| Endpoint                | Scope              |
| ----------------------- | ------------------ |
| List/Get incidents      | `incidents:read`   |
| Create/Update incidents | `incidents:write`  |
| Delete incidents        | `incidents:delete` |

---

## List Incidents

Retrieve a paginated list of incidents.

### Endpoint

```http
GET /api/incidents
```

### Query Parameters

| Parameter       | Type   | Default     | Description                                                         |
| --------------- | ------ | ----------- | ------------------------------------------------------------------- |
| `limit`         | number | 50          | Results per page (max 200)                                          |
| `offset`        | number | 0           | Pagination offset                                                   |
| `status`        | string | -           | Filter: `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `SNOOZED`, `SUPPRESSED` |
| `urgency`       | string | -           | Filter: `HIGH`, `MEDIUM`, `LOW`                                     |
| `serviceId`     | string | -           | Filter by service                                                   |
| `teamId`        | string | -           | Filter by team                                                      |
| `assigneeId`    | string | -           | Filter by assignee                                                  |
| `createdAfter`  | string | -           | ISO 8601 datetime                                                   |
| `createdBefore` | string | -           | ISO 8601 datetime                                                   |
| `sort`          | string | `createdAt` | Sort field                                                          |
| `order`         | string | `desc`      | `asc` or `desc`                                                     |

### Example Request

```bash
curl -X GET "https://your-opsknight.com/api/incidents?status=OPEN&urgency=HIGH&limit=25" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Response

```json
{
  "incidents": [
    {
      "id": "inc_abc123",
      "title": "Database connection timeout",
      "description": "Primary database is not responding",
      "status": "OPEN",
      "urgency": "HIGH",
      "service": {
        "id": "svc_xyz789",
        "name": "Payment API"
      },
      "assignee": null,
      "createdAt": "2024-01-15T10:30:00Z",
      "acknowledgedAt": null,
      "resolvedAt": null,
      "dedupKey": "db-timeout-primary"
    },
    {
      "id": "inc_def456",
      "title": "High memory usage",
      "description": "Memory usage above 95%",
      "status": "ACKNOWLEDGED",
      "urgency": "MEDIUM",
      "service": {
        "id": "svc_xyz789",
        "name": "Payment API"
      },
      "assignee": {
        "id": "usr_jane",
        "name": "Jane Engineer",
        "email": "jane@example.com"
      },
      "createdAt": "2024-01-15T09:15:00Z",
      "acknowledgedAt": "2024-01-15T09:20:00Z",
      "resolvedAt": null,
      "dedupKey": "memory-high-app01"
    }
  ],
  "total": 47,
  "limit": 25,
  "offset": 0,
  "hasMore": true
}
```

### Response Fields

| Field       | Type    | Description              |
| ----------- | ------- | ------------------------ |
| `incidents` | array   | List of incident objects |
| `total`     | number  | Total matching incidents |
| `limit`     | number  | Results per page         |
| `offset`    | number  | Current offset           |
| `hasMore`   | boolean | More results available   |

---

## Get Incident

Retrieve a single incident by ID.

### Endpoint

```http
GET /api/incidents/:id
```

### Example Request

```bash
curl -X GET "https://your-opsknight.com/api/incidents/inc_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Response

```json
{
  "id": "inc_abc123",
  "title": "Database connection timeout",
  "description": "Primary database is not responding to queries. Connection pool exhausted.",
  "status": "OPEN",
  "urgency": "HIGH",
  "priority": "P1",
  "service": {
    "id": "svc_xyz789",
    "name": "Payment API",
    "team": {
      "id": "team_platform",
      "name": "Platform Engineering"
    }
  },
  "assignee": null,
  "assignedTeam": {
    "id": "team_platform",
    "name": "Platform Engineering"
  },
  "dedupKey": "db-timeout-primary",
  "source": "prometheus",
  "integration": {
    "id": "int_abc",
    "name": "Prometheus Alerts",
    "type": "prometheus"
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "acknowledgedAt": null,
  "resolvedAt": null,
  "snoozedUntil": null,
  "lastStatusChange": "2024-01-15T10:30:00Z",
  "escalationPolicy": {
    "id": "pol_payment",
    "name": "Payment API Escalation"
  },
  "currentEscalationStep": 2,
  "customDetails": {
    "database": "postgres-primary",
    "timeout_ms": 30000,
    "affected_queries": 150
  },
  "timeline": [
    {
      "id": "evt_001",
      "type": "created",
      "timestamp": "2024-01-15T10:30:00Z",
      "actor": "system",
      "details": "Incident triggered via Prometheus integration"
    },
    {
      "id": "evt_002",
      "type": "escalation",
      "timestamp": "2024-01-15T10:35:00Z",
      "actor": "system",
      "details": "Escalated to step 2: Secondary On-Call"
    }
  ],
  "notes": [],
  "links": [
    {
      "href": "https://grafana.example.com/dashboard/db",
      "text": "Database Dashboard"
    }
  ],
  "relatedIncidents": []
}
```

---

## Create Incident

Create a new incident manually.

### Endpoint

```http
POST /api/incidents
```

### Request Body

```json
{
  "title": "Manual incident: Payment system down",
  "description": "Customer reports payments are failing. Investigating.",
  "serviceId": "svc_xyz789",
  "urgency": "HIGH",
  "priority": "P1",
  "assigneeId": "usr_jane",
  "customDetails": {
    "reported_by": "Customer Support",
    "ticket_id": "SUP-12345"
  }
}
```

### Request Fields

| Field                   | Type    | Required | Description                              |
| ----------------------- | ------- | :------: | ---------------------------------------- |
| `title`                 | string  |   Yes    | Incident title (max 255 chars)           |
| `description`           | string  |    No    | Detailed description                     |
| `serviceId`             | string  |   Yes    | Service ID                               |
| `urgency`               | string  |    No    | `HIGH`, `MEDIUM`, `LOW` (default: `LOW`) |
| `priority`              | string  |    No    | `P1`, `P2`, `P3`, `P4`, `P5`             |
| `assigneeId`            | string  |    No    | User ID to assign                        |
| `assignedTeamId`        | string  |    No    | Team ID to assign                        |
| `dedupKey`              | string  |    No    | Custom deduplication key                 |
| `customDetails`         | object  |    No    | Arbitrary key-value pairs                |
| `links`                 | array   |    No    | Related links                            |
| `suppressNotifications` | boolean |    No    | Skip initial notifications               |

### Example Request

```bash
curl -X POST "https://your-opsknight.com/api/incidents" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Elevated API error rate",
    "description": "Error rate jumped to 5% in the last 10 minutes",
    "serviceId": "svc_xyz789",
    "urgency": "MEDIUM",
    "customDetails": {
      "error_rate": 5.2,
      "normal_rate": 0.5
    }
  }'
```

### Response

```json
{
  "id": "inc_new123",
  "title": "Elevated API error rate",
  "status": "OPEN",
  "urgency": "MEDIUM",
  "createdAt": "2024-01-15T11:00:00Z"
}
```

---

## Update Incident

Update an existing incident.

### Endpoint

```http
PATCH /api/incidents/:id
```

### Request Body

```json
{
  "status": "ACKNOWLEDGED",
  "urgency": "HIGH",
  "assigneeId": "usr_jane",
  "description": "Updated description with more details"
}
```

### Updatable Fields

| Field            | Type   | Description                                   |
| ---------------- | ------ | --------------------------------------------- |
| `status`         | string | `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `SNOOZED` |
| `urgency`        | string | `HIGH`, `MEDIUM`, `LOW`                       |
| `priority`       | string | `P1` through `P5`                             |
| `assigneeId`     | string | User ID or `null` to unassign                 |
| `assignedTeamId` | string | Team ID or `null` to unassign                 |
| `title`          | string | Update title                                  |
| `description`    | string | Update description                            |
| `customDetails`  | object | Merge with existing custom details            |
| `snoozeDuration` | number | Minutes to snooze (when status=SNOOZED)       |

### Status Transitions

| From         | Valid To                                    |
| ------------ | ------------------------------------------- |
| OPEN         | ACKNOWLEDGED, RESOLVED, SNOOZED, SUPPRESSED |
| ACKNOWLEDGED | OPEN, RESOLVED, SNOOZED                     |
| SNOOZED      | OPEN, ACKNOWLEDGED, RESOLVED                |
| RESOLVED     | OPEN (reopen)                               |

### Example: Acknowledge

```bash
curl -X PATCH "https://your-opsknight.com/api/incidents/inc_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "ACKNOWLEDGED"
  }'
```

### Example: Resolve with Note

```bash
curl -X PATCH "https://your-opsknight.com/api/incidents/inc_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "RESOLVED",
    "resolutionNote": "Restarted connection pool, issue resolved"
  }'
```

### Example: Snooze

```bash
curl -X PATCH "https://your-opsknight.com/api/incidents/inc_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "SNOOZED",
    "snoozeDuration": 30
  }'
```

### Example: Reassign

```bash
curl -X PATCH "https://your-opsknight.com/api/incidents/inc_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "assigneeId": "usr_bob"
  }'
```

### Response

```json
{
  "id": "inc_abc123",
  "status": "ACKNOWLEDGED",
  "urgency": "HIGH",
  "assignee": {
    "id": "usr_jane",
    "name": "Jane Engineer"
  },
  "updatedAt": "2024-01-15T10:45:00Z"
}
```

---

## Add Note

Add a note/comment to an incident.

### Endpoint

```http
POST /api/incidents/:id/notes
```

### Request Body

```json
{
  "content": "Investigating database logs. Found connection pool exhaustion."
}
```

### Request Fields

| Field        | Type    | Required | Description                              |
| ------------ | ------- | :------: | ---------------------------------------- |
| `content`    | string  |   Yes    | Note content (max 10000 chars)           |
| `isInternal` | boolean |    No    | Internal note (not shown on status page) |

### Example Request

```bash
curl -X POST "https://your-opsknight.com/api/incidents/inc_abc123/notes" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Root cause identified: Connection pool limit too low for current traffic."
  }'
```

### Response

```json
{
  "id": "note_xyz",
  "content": "Root cause identified: Connection pool limit too low for current traffic.",
  "author": {
    "id": "usr_jane",
    "name": "Jane Engineer"
  },
  "createdAt": "2024-01-15T11:00:00Z",
  "isInternal": false
}
```

---

## Get Timeline

Retrieve the complete timeline of an incident.

### Endpoint

```http
GET /api/incidents/:id/timeline
```

### Example Request

```bash
curl -X GET "https://your-opsknight.com/api/incidents/inc_abc123/timeline" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Response

```json
{
  "timeline": [
    {
      "id": "evt_001",
      "type": "created",
      "timestamp": "2024-01-15T10:30:00Z",
      "actor": {
        "type": "system",
        "name": "Prometheus Integration"
      },
      "details": {
        "message": "Incident triggered",
        "source": "prometheus"
      }
    },
    {
      "id": "evt_002",
      "type": "notification_sent",
      "timestamp": "2024-01-15T10:30:05Z",
      "actor": {
        "type": "system"
      },
      "details": {
        "channel": "slack",
        "recipient": "#incidents",
        "status": "delivered"
      }
    },
    {
      "id": "evt_003",
      "type": "escalation",
      "timestamp": "2024-01-15T10:35:00Z",
      "actor": {
        "type": "system"
      },
      "details": {
        "from_step": 1,
        "to_step": 2,
        "reason": "No acknowledgment within 5 minutes"
      }
    },
    {
      "id": "evt_004",
      "type": "acknowledged",
      "timestamp": "2024-01-15T10:37:00Z",
      "actor": {
        "type": "user",
        "id": "usr_jane",
        "name": "Jane Engineer"
      },
      "details": {
        "via": "slack"
      }
    },
    {
      "id": "evt_005",
      "type": "note_added",
      "timestamp": "2024-01-15T10:45:00Z",
      "actor": {
        "type": "user",
        "id": "usr_jane",
        "name": "Jane Engineer"
      },
      "details": {
        "note_id": "note_xyz"
      }
    }
  ]
}
```

### Timeline Event Types

| Type                     | Description                       |
| ------------------------ | --------------------------------- |
| `created`                | Incident created                  |
| `acknowledged`           | Incident acknowledged             |
| `resolved`               | Incident resolved                 |
| `snoozed`                | Incident snoozed                  |
| `unsnoozed`              | Snooze expired                    |
| `suppressed`             | Incident suppressed               |
| `escalation`             | Escalated to next step            |
| `notification_sent`      | Notification dispatched           |
| `notification_delivered` | Notification confirmed delivered  |
| `notification_failed`    | Notification delivery failed      |
| `assigned`               | Assignee changed                  |
| `reassigned`             | Reassigned to different user/team |
| `urgency_changed`        | Urgency level changed             |
| `note_added`             | Note added                        |
| `merged`                 | Merged with another incident      |
| `linked`                 | Linked to related incident        |

---

## Merge Incidents

Merge multiple related incidents into one.

### Endpoint

```http
POST /api/incidents/:id/merge
```

### Request Body

```json
{
  "sourceIncidentIds": ["inc_def456", "inc_ghi789"]
}
```

### Behavior

- Source incidents are marked as merged
- Their timeline events are copied to target
- Notifications reference the merged incident
- Source incidents become read-only

### Example Request

```bash
curl -X POST "https://your-opsknight.com/api/incidents/inc_abc123/merge" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceIncidentIds": ["inc_def456", "inc_ghi789"]
  }'
```

### Response

```json
{
  "id": "inc_abc123",
  "mergedIncidents": ["inc_def456", "inc_ghi789"],
  "mergedAt": "2024-01-15T11:00:00Z"
}
```

---

## Bulk Update

Update multiple incidents at once.

### Endpoint

```http
POST /api/incidents/bulk
```

### Request Body

```json
{
  "incidentIds": ["inc_abc123", "inc_def456", "inc_ghi789"],
  "updates": {
    "status": "ACKNOWLEDGED"
  }
}
```

### Supported Bulk Updates

| Field            | Description    |
| ---------------- | -------------- |
| `status`         | Change status  |
| `assigneeId`     | Assign to user |
| `assignedTeamId` | Assign to team |
| `urgency`        | Change urgency |

### Example: Bulk Acknowledge

```bash
curl -X POST "https://your-opsknight.com/api/incidents/bulk" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "incidentIds": ["inc_abc123", "inc_def456"],
    "updates": {
      "status": "ACKNOWLEDGED"
    }
  }'
```

### Response

```json
{
  "updated": 2,
  "failed": 0,
  "results": [
    { "id": "inc_abc123", "status": "success" },
    { "id": "inc_def456", "status": "success" }
  ]
}
```

---

## Delete Incident

Delete an incident (admin only).

### Endpoint

```http
DELETE /api/incidents/:id
```

### Example Request

```bash
curl -X DELETE "https://your-opsknight.com/api/incidents/inc_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Response

```json
{
  "deleted": true,
  "id": "inc_abc123"
}
```

> **Warning**: Deletion is permanent. Consider resolving incidents instead of deleting them.

---

## Incident Object Reference

### Full Incident Object

```json
{
  "id": "inc_abc123",
  "title": "string",
  "description": "string",
  "status": "OPEN | ACKNOWLEDGED | RESOLVED | SNOOZED | SUPPRESSED",
  "urgency": "HIGH | MEDIUM | LOW",
  "priority": "P1 | P2 | P3 | P4 | P5",
  "service": {
    "id": "string",
    "name": "string",
    "team": { "id": "string", "name": "string" }
  },
  "assignee": {
    "id": "string",
    "name": "string",
    "email": "string"
  },
  "assignedTeam": {
    "id": "string",
    "name": "string"
  },
  "dedupKey": "string",
  "source": "string",
  "integration": {
    "id": "string",
    "name": "string",
    "type": "string"
  },
  "escalationPolicy": {
    "id": "string",
    "name": "string"
  },
  "currentEscalationStep": "number",
  "createdAt": "ISO 8601 datetime",
  "acknowledgedAt": "ISO 8601 datetime | null",
  "resolvedAt": "ISO 8601 datetime | null",
  "snoozedUntil": "ISO 8601 datetime | null",
  "lastStatusChange": "ISO 8601 datetime",
  "customDetails": { "key": "value" },
  "timeline": ["TimelineEvent"],
  "notes": ["Note"],
  "links": [{ "href": "string", "text": "string" }],
  "relatedIncidents": ["string"]
}
```

---

## Error Responses

### Common Errors

| HTTP Status | Code               | Description                |
| ----------- | ------------------ | -------------------------- |
| 400         | `INVALID_REQUEST`  | Malformed request body     |
| 400         | `INVALID_STATUS`   | Invalid status transition  |
| 401         | `UNAUTHORIZED`     | Missing or invalid API key |
| 403         | `FORBIDDEN`        | Insufficient permissions   |
| 404         | `NOT_FOUND`        | Incident not found         |
| 409         | `CONFLICT`         | Concurrent modification    |
| 422         | `VALIDATION_ERROR` | Field validation failed    |
| 429         | `RATE_LIMITED`     | Too many requests          |
| 500         | `INTERNAL_ERROR`   | Server error               |

### Error Response Format

```json
{
  "status": "error",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title is required",
    "details": {
      "field": "title",
      "reason": "required"
    }
  }
}
```

---

## Rate Limits

| Endpoint                 | Limit      |
| ------------------------ | ---------- |
| GET /api/incidents       | 100/minute |
| GET /api/incidents/:id   | 200/minute |
| POST /api/incidents      | 50/minute  |
| PATCH /api/incidents/:id | 100/minute |
| POST /api/incidents/bulk | 10/minute  |

---

## Best Practices

### When to Use Incidents API vs Events API

| Use Case                         | API           |
| -------------------------------- | ------------- |
| Automated alerts from monitoring | Events API    |
| Manual incident creation         | Incidents API |
| Custom workflow automation       | Incidents API |
| Programmatic status updates      | Incidents API |
| Auto-resolve from monitoring     | Events API    |

### Pagination

For large result sets:

- Use `limit` and `offset` for pagination
- Process results in batches
- Use filters to reduce result sets

### Efficient Queries

- Filter by status to get only active incidents
- Filter by date range for historical queries
- Use specific service/team filters when possible

### Handling Updates

- Check incident exists before updating
- Handle 404s gracefully
- Use optimistic locking headers if available

---

## Related Topics

- [Events API](./events) — Alert-driven incident creation
- [Incidents](../core-concepts/incidents) — Incident lifecycle
- [Services](../core-concepts/services) — Service configuration
- [Escalation Policies](../core-concepts/escalation-policies) — Notification routing
