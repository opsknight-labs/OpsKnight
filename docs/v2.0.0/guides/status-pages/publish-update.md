---
title: Publish a status update
description: Communicate an incident through a deliberately scoped status page.
type: how-to
product_area: status-pages
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/status-page-projection.ts
    - src/lib/status-page-content.ts
---

# Publish a status update

Confirm the intended page, audience, affected services, and privacy controls.
Create or update the incident announcement with customer-safe wording, then
verify the public or authenticated page through the same hostname customers use.

Internal incident visibility does not automatically define status-page output.
Review title, description, assignee, urgency, custom-field, and history exposure
settings before publishing. Confirm subscriber and webhook projection separately.

