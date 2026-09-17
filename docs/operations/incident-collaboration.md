# Incident Collaboration Platform Operations Runbook

## Overview

OpsKnight provides resilient, multi-provider incident collaboration across chat war rooms (Slack, Microsoft Teams) and real-time meeting bridges (Microsoft Teams, Zoom, Google Meet, Jitsi).

The platform adheres to strict operational guarantees:

- **Canonical Persistence**: Both `IncidentWarRoom` and `IncidentMeeting` tables serve as the sole source of truth in PostgreSQL.
- **Read Purity**: Incident page rendering and RSC views read purely from the database and configuration; they never perform synchronous network calls to external APIs.
- **Concurrency & Fencing**: Token-fenced compare-and-swap (CAS) transitions prevent duplicate room or meeting bridge provisioning under concurrent trigger flows.
- **Background Worker Decoupling**: Durable background jobs (`WAR_ROOM_PROVISION`, `WAR_ROOM_PROJECT`, `WAR_ROOM_CLOSE`, `MEETING_PROVISION`, `MEETING_CLOSE`) isolate external provider latencies and failures from user-facing request paths.
- **Cleanup Debt Tracking**: Meetings that encounter transient failures during deletion remain marked with `externalCleanupPending = true` until background reconciliation recovers them.

---

## State Machine & Lifecycle

### IncidentMeeting Lifecycle

```text
               requestMeetingProvision()
                      │
                      ▼
               [ PROVISIONING ]
                      │
        ┌─────────────┴─────────────┐
 (Adapter 200)               (Terminal 4xx)
        ▼                           ▼
    [ READY ]                   [ FAILED ]
        │                           │
  closeIncidentMeeting()     provisionIncidentMeeting()
        │                           │
        ▼                           ▼
   [ CLOSING ]               [ PROVISIONING ] (Gen + 1)
        │
 (Delete 204/404)
        ▼
    [ CLOSED ] (externalCleanupPending: false)
```

---

## Background Workers & Reconciliation

| Job Type            | Trigger                             | Functionality                                                                                                                          | Retry Behavior                                                                            |
| :------------------ | :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `MEETING_PROVISION` | `requestMeetingProvision()`         | Invokes provider adapter with deterministic `externalId`, validates token CAS, updates row to `READY`, triggers war-room reprojection. | Exponential backoff for 429/5xx, fail-closed on 401/403.                                  |
| `MEETING_CLOSE`     | `closeIncidentMeeting()`            | Transitions row to `CLOSING`, deletes external meeting via Graph (204/404 settled as success), marks `CLOSED`.                         | Retries transient errors; flags `externalCleanupPending = true` if retry budget exhausts. |
| `WAR_ROOM_PROJECT`  | `requestWarRoomProjectionNeutral()` | Renders canonical incident + meeting cards and updates provider channels with monotonic `projectionVersion`.                           | Rate-limit aware backoff.                                                                 |

### Reconciliation Tasks

- **`reconcileStalledMeetingProvisions(thresholdMs = 5m)`**: Identifies meetings stuck in `PROVISIONING` longer than the threshold and re-enqueues `MEETING_PROVISION` with an incremented attempt count.
- **`reconcileMeetingCleanupDebt()`**: Sweeps meetings with `externalCleanupPending = true` and invokes `retryIncidentMeetingCleanup(meetingId)` to settle external orphaned resources.
- **`reconcileMeetingProjectionDrift()`**: Ensures war-room card projections match the canonical meeting generation and join URL.

---

## Operational Status & Health Verification

### Admin API Endpoints

- `GET /api/admin/incident-collaboration`: Operational summary of active/degraded war rooms, canonical meetings, and pending cleanup debt.
- `POST /api/admin/incident-collaboration/meetings/:meetingId/retry-cleanup`: Dedicated REST endpoint to claim and enqueue cleanup retry for an orphaned meeting resource.
- `POST /api/admin/incident-collaboration`: Admin endpoint supporting `{ action: 'retry_cleanup', meetingId }`.
- `POST /api/admin/war-rooms/:warRoomId/repair`: Force reconciles and reprojects an out-of-sync war-room channel card.

### Verification Queries

```sql
-- Check active meetings and their health
SELECT "id", "incidentId", "provider", "generation", "state", "health", "externalCleanupPending", "closeToken", "cleanupRetryCount", "joinUrl"
FROM "IncidentMeeting"
WHERE "state" IN ('PROVISIONING', 'READY', 'CLOSING')
ORDER BY "createdAt" DESC;

-- Identify external cleanup debt
SELECT "id", "incidentId", "provider", "lastErrorCode", "lastErrorMessage", "cleanupAttemptedAt", "cleanupRetryCount"
FROM "IncidentMeeting"
WHERE "externalCleanupPending" = true;

-- Verify background job queue health for collaboration
SELECT "type", "status", COUNT(*)
FROM "BackgroundJob"
WHERE "type" IN ('WAR_ROOM_PROVISION', 'WAR_ROOM_PROJECT', 'WAR_ROOM_CLOSE', 'MEETING_PROVISION', 'MEETING_CLOSE')
GROUP BY "type", "status";
```

---

## Operational Troubleshooting & Runbooks

### 1. Microsoft Graph 429 Rate Limiting

- **Symptom**: `WarRoomRetryableError: Microsoft Graph rate limit exceeded (429)`.
- **System Behavior**: Meeting row stays in `CLOSING` or `PROVISIONING` with `health: DEGRADED`. Worker pauses and job is rescheduled according to `Retry-After` header.
- **Action**: No manual intervention required for transient bursts. If persistent, verify tenant-wide Graph call volume or add additional meeting organizer accounts.

### 2. Permissions / Consent Revocation (401/403)

- **Symptom**: Meeting state transitions to `FAILED` with `health: UNAVAILABLE` and error `Missing OnlineMeetings.ReadWrite.All permission`.
- **System Behavior**: Job settles immediately without burn-down retries to protect log budgets.
- **Action**:
  1. Verify Entra Application credentials under **Admin Settings -> ChatOps -> Microsoft Teams**.
  2. Confirm Application Access Policy in Teams PowerShell: `Grant-CsApplicationAccessPolicy -PolicyName "OpsKnightPolicy" -Identity "organizer@example.com"`.
  3. Once resolved, click **Retry Meeting** in the incident UI or call `provisionIncidentMeeting(incidentId)`.

### 3. Ambiguous External Success / Lost Responses

- **Symptom**: Network timeout during external meeting creation call.
- **System Behavior**: Provider adapters use deterministic `externalId` (`opsknight:<incidentId>:<generation>`). Graph's `createOrGet` retrieves the previously created meeting idempotently on the next retry attempt without spawning duplicate meetings.

### 4. Stalled Worker Recovery & Cleanup Debt Remediation

- **Preflight Verification**: Verify local/CI deployment database columns, indexes, invariant contracts, and adapters:
  ```bash
  npm run certify:collaboration:preflight
  ```
- **Staging / Production Certification**: In staging or production, live end-to-end certification executes against configured Slack and Microsoft Teams tenants using real OAuth credentials and Teams online meetings lifecycle.
- **Cleanup Debt Remediation**: If an external meeting resource failed deletion and exhausted retries, an admin can trigger immediate retry:
  ```bash
  curl -X POST /api/admin/incident-collaboration/meetings/<meetingId>/retry-cleanup \
    -H "Authorization: Bearer <ADMIN_SESSION_COOKIE>"
  ```
  The worker will validate the meeting's generation and `closeToken` lease before re-attempting deletion with the provider. Upon success, `externalCleanupPending` is cleared, `health` is restored to `HEALTHY`, and the cleanup debt gauge drops to 0.
