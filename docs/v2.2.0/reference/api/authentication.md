---
title: API authentication
description: Authenticate supported OpsKnight API requests and rotate credentials safely.
type: reference
product_area: api
audience: [developer, operator, administrator]
keywords: [API token, API key, bearer authentication, API permissions, rotate API key]
verification:
  level: runtime
  verified_at: 2026-09-27
  evidence:
    - src/lib/api-auth.ts
    - src/lib/api-keys.ts
    - prisma/schema.prisma
    - tests/docs/journeys/zz-api-contracts.spec.ts
    - generated/docs-certification/current.json
---

# API authentication

Supported REST API requests use an OpsKnight API key. Send the key using one of
these headers; `Authorization: Bearer` is preferred:

```http
Authorization: Bearer ok_live_REDACTED
```

```http
X-API-Key: ok_live_REDACTED
```

`Authorization: Api-Key ok_live_REDACTED` is also accepted for compatibility.
Keys belong to a user. The user must remain active, and every request is still
restricted by that user's role and resource access. A key that is expired,
revoked, unknown, or owned by an inactive user is rejected.

Treat the full key as a secret: store it in a secret manager, never place it in
a URL or log, and transmit it only over TLS. OpsKnight stores a keyed hash, so
the clear-text value cannot be recovered later. Create a replacement, update
the client, verify a request with the replacement, and then revoke the old key.

Events API v2 integrations may instead use their service-scoped routing key:

```http
Authorization: Token token=REDACTED_ROUTING_KEY
```

That form is valid only for an enabled `EVENTS_API_V2` integration and binds
events to the integration's service. Provider webhook keys are not accepted by
the generic events endpoint.
