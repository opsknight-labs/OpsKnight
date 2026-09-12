# Enterprise incident response policy

OpsKnight resolves a new incident through one canonical chain:

`trusted integration → service → workspace → immutable SLA contract → engagement → escalation → notification queue`.

Priority and urgency inherit independently. Priority supports `INHERIT`, `SET`, and terminal `CLEAR`; urgency supports `INHERIT`, `SET`, and `DEFAULT`. A priority `CLEAR` cannot be undone by urgency fallback. Integration identity is taken only from an authenticated routing key/provider binding and is never accepted from alert payload data.

Support hours control engagement, not SLA time. LOW-urgency work may be deferred until the next staffed window. HIGH urgency bypasses that deferral. SLA time continues unless the existing, separate SLA pause lifecycle explicitly pauses it.

Escalation conditions are a bounded typed language over `PRIORITY`, `URGENCY`, and `SUPPORT_HOURS_STATE`, with `IN`, `NOT_IN`, `EQUALS`, and `NOT_EQUALS`. Empty conditions preserve legacy always-applicable behavior. Notification channels remain owned by escalation/user configuration and all delivery continues through the central durable queue.

## Management API

Use an administrator-owned API key with `response-policy:read` and, for mutations, `response-policy:write`. Writes require `If-Match: "<current-version>"`; stale writes return `409`.

- `GET|PUT /api/v1/response-policy/workspace`
- `GET|PUT /api/v1/response-policy/classification?scopeKey=...`
- `GET|PUT /api/v1/response-policy/sla?scopeKey=...`
- `GET|PUT /api/v1/services/:id/response-policy`
- `GET|PUT /api/v1/integrations/:id/response-policy`
- `POST /api/v1/response-policy/preview`
- `GET /api/v1/response-policy/history`
- `GET /api/v1/response-policy/diff`
- `POST /api/v1/response-policy/restore`
- `GET|PUT /api/v1/response-policy/support-hours`

Restore validates an old snapshot and publishes it as a new immutable version; it never makes an old row current or edits sealed history.

## Indexed SLA scheduler rollout

1. Apply the additive migration and upgrade every web and worker replica.
2. Run `npm run prisma:indexes:sla-scheduler` to build the index concurrently.
3. In Settings → Incident Response Policy, change the scheduler from Legacy to Shadow.
4. Observe projection health and compare shadow results before selecting Indexed.
5. Roll back live by selecting Legacy; no environment edit, restart, or deployment is required.

The indexed timestamp is only an optimization. Workers always re-run the canonical pause-aware SLA projector before emitting an idempotent event and repair stale hints.
