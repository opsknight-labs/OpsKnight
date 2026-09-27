---
title: Integration webhook is rejected
description: Diagnose authentication, signature, replay, rate-limit, and payload failures.
type: troubleshooting
product_area: integrations
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/integrations/handler.ts, src/lib/integrations/request-security.ts]
---

# Integration webhook is rejected

Record the provider, endpoint, status code, delivery identifier, and timestamp.
Confirm the integration exists, is enabled, and matches the route type. Then check
key resolution, signature secret and timestamp, replay claim, rate limit, content
type, and schema validation. Redact credentials and payload secrets before sharing
evidence. Replaying the same genuine delivery identifier may be intentionally
deduplicated.

