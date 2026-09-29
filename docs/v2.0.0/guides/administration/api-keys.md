---
title: Manage API keys
description: Create, scope, rotate, inspect, and revoke OpsKnight API credentials.
type: how-to
product_area: administration
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/settings/api-keys, src/lib/api-keys.ts, src/lib/api-auth.ts]
---

# Manage API keys

## Before you begin

Sign in as an administrator and identify the endpoints and minimum scopes the
consumer requires.

Create API keys in **Settings → API keys**. Select only the scopes needed by the
automation and set an expiration when the credential is not permanent.

1. Open **Settings → API keys** and create a key.
2. Select the minimum scopes and an expiration.
3. Copy the secret once into a secret manager.
4. Make a test request and verify **Last used** changes.

The secret is displayed once. Store it in a secret manager; OpsKnight retains a
keyed hash, the visible prefix, owner, scopes, expiration, and last used time.
Send the secret as `Authorization: Bearer <key>` or `X-API-Key` where documented.

## Rotation

1. Create a replacement with the same minimum scopes.
2. Update the consumer and verify its last used value changes.
3. Revoke the old key.
4. Confirm the revocation in the audit log.

Revocation is immediate. It does not delete audit history. If a secret is
exposed, revoke it before investigating the consumer.

## Troubleshooting

- `401`: the secret is missing, malformed, expired, revoked, or owned by an
  inactive user.
- `403`: authentication succeeded but the key lacks a required scope or its
  owner lacks product permission.
- No last used update: verify the header, endpoint, and that the request reached
  this OpsKnight installation.

See [Permissions and API scopes](../../reference/permissions/).
