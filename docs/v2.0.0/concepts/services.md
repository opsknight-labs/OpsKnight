---
title: Services
description: Service ownership, alert routing, and operational context.
type: concept
product_area: services
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [prisma/schema.prisma, src/app/(app)/services/]
---

# Services

Services connect ownership, escalation, alert ingestion, incidents, status
communication, and reliability objectives around an operated system.

A service provides the routing boundary for incoming events and owns the
escalation and notification configuration applied to new incidents. Team
ownership controls who can administer or respond within scope. Status-page
components and external integrations may expose selected service state without
exposing the complete internal record.

Changes affect future routing; they must not silently rewrite frozen targets or
historical ownership on existing incidents. Use stable service identity for
integrations and change names only as display metadata.
