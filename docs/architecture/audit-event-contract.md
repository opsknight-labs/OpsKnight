# Audit-event contract

All durable audit writes flow through `src/lib/audit.ts`. The versioned payload
records the actor snapshot, action, target, occurrence time, request ID, source,
old value, new value, and redacted metadata. Indexed legacy columns remain
populated for current queries and rate limits.

Sources are `UI`, `API`, `INTEGRATION`, `AUTOMATION`, `BACKGROUND`, `AUTH`, or
`SYSTEM`. New callers must select one explicitly and pass the active request ID
when a request exists. Background work receives a generated correlation ID.

Audit writes that describe a transactional domain mutation should use
`emitAuditEvent(input, tx)` inside the same database transaction. Authentication
audit failures remain best-effort so telemetry cannot prevent login or recovery.

Sensitive keys and credential-shaped strings are redacted before persistence.
Direct `prisma.auditLog.create()` calls outside the emitter fail architecture
tests.
