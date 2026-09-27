---
title: Incident SLA
description: Frozen acknowledgement and resolution targets for incidents.
type: concept
product_area: incident-sla
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/incident-sla.ts, prisma/schema.prisma]
---

# Incident SLA

Incident SLA targets define response expectations. The applicable target and
its source are frozen on incident creation so later policy edits do not rewrite
the historical contract.

Acknowledgement and resolution clocks have separate targets and elapsed values.
The captured policy source, version, rule, and priority explain why a target was
chosen. Pauses contribute explicit paused duration rather than changing the
original target.

Operators should alert on upcoming transitions and scheduler health, then use
the stored incident fields for audits. Recomputing historical compliance from
today's service policy produces incorrect results.
