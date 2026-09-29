---
title: Review audit logs
description: Search security and administrative changes and preserve evidence for investigations.
type: how-to
product_area: administration
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/audit, src/lib/audit.ts]
---

# Review audit logs

## Before you begin

Obtain audit-view permission and the incident time range, actor, resource, or
request correlation ID you need to investigate.

1. Open **Audit** and select the narrowest useful time range.
2. Filter by actor, action, resource, outcome, or correlation ID.
3. Open matching records and correlate them with system or delivery logs.
4. Export or preserve the required evidence under your retention policy.

Verify that the resulting record identifies the expected actor, action,
resource, timestamp, and outcome before closing the investigation.

Open **Audit** to investigate who changed a protected resource, which action was
attempted, when it occurred, and whether it succeeded. Narrow the time window
first, then filter by actor, action, resource, or correlation identifier.

Audit records are security evidence, not application debug logs. Export or
preserve relevant records according to your retention and access policy. A
missing expected record should be investigated alongside system logs and the
request correlation ID; do not infer that no action occurred from a UI filter.

Restrict audit access to authorized administrators. Audit payloads can contain
resource identifiers and operational metadata, but credentials must never be
copied into investigation notes.
