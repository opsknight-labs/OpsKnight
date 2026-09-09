# Enterprise incident response policy

OpsKnight resolves a new incident through one canonical chain:

`trusted integration → service → workspace → immutable SLA contract → engagement → escalation → notification queue`.

Priority and urgency inherit independently. Priority supports `INHERIT`, `SET`, and terminal `CLEAR`; urgency supports `INHERIT`, `SET`, and `DEFAULT`. A priority `CLEAR` cannot be undone by urgency fallback. Integration identity is taken only from an authenticated routing key/provider binding and is never accepted from alert payload data.

Support hours control engagement, not SLA time. LOW-urgency work may be deferred until the next staffed window. HIGH urgency bypasses that deferral. SLA time continues unless the existing, separate SLA pause lifecycle explicitly pauses it.

Escalation conditions are a bounded typed language over `PRIORITY`, `URGENCY`, and `SUPPORT_HOURS_STATE`, with `IN`, `NOT_IN`, `EQUALS`, and `NOT_EQUALS`. Empty conditions preserve legacy always-applicable behavior. Notification channels remain owned by escalation/user configuration and all delivery continues through the central durable queue.

## Management API

Use an administrator-owned API key with `response-policy:read` and, for mutations, `response-policy:write`. Writes require `If-Match: "<current-version>"`; stale writes return `409`.

- `GET|PUT /api/v1/response-policy/workspace`
- `GET|PUT /api/v1/services/:id/response-policy`
- `GET|PUT /api/v1/integrations/:id/response-policy`
- `POST /api/v1/response-policy/preview`
- `GET /api/v1/response-policy/history`
- `GET /api/v1/response-policy/diff`
- `POST /api/v1/response-policy/restore`
- `GET|PUT /api/v1/response-policy/support-hours`

Restore validates an old snapshot and publishes it as a new immutable version; it never makes an old row current or edits sealed history.

## Indexed SLA scheduler rollout

1. Apply the additive migration while `INDEXED_SLA_SCHEDULER=false`.
2. Upgrade every web and worker replica.
3. Observe legacy capture, policy conflicts, projection errors, escalation lag, and notification backlog.
4. Set `INDEXED_SLA_SCHEDULER=true` for scheduler/worker replicas.
5. Roll back by setting it to `false`; captured policies and scheduling hints remain safe.

The indexed timestamp is only an optimization. Workers always re-run the canonical pause-aware SLA projector before emitting an idempotent event and repair stale hints.
