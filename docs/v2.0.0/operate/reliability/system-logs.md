---
title: Operate with system logs
description: Use structured runtime logs and request correlation IDs to diagnose OpsKnight.
type: how-to
product_area: observability
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/system-logs, src/lib/logger.ts, src/lib/request-context.ts]
---

# Operate with system logs

## Before you begin

Obtain operator access and preserve the error time, component, incident or job
identifier, and request correlation ID.

1. Open **System logs** and select the incident time range.
2. Filter by severity, component, runtime role, or correlation ID.
3. Follow related request, queue, worker, and provider records.
4. Verify the diagnosed condition against metrics or a synthetic workflow.

Use **System logs** for application and worker diagnostics. Filter by time,
severity, component, runtime role, and request correlation ID. Start with the
user-visible error time and request ID, then follow related worker or provider
events.

Logs are not the audit trail. Use audit logs for security-sensitive mutations
and delivery history for notification attempts. Centralize container logs with
access controls, retention, and redaction appropriate for operational metadata.
Never enable secret logging to diagnose authentication.

If logs are absent, verify the affected runtime role is running, its stdout is
collected, the time range is correct, and retention has not expired. If a queue
job lacks a browser request ID, correlate by incident, notification, or job ID.
