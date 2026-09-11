---
order: 2
title: SCIM Provisioning
description: Provision, update, and deprovision OpsKnight users through SCIM 2.0
---

# SCIM Provisioning

OpsKnight v1.5 exposes a SCIM 2.0 **Users** endpoint for identity-provider lifecycle management. Use OIDC for interactive authentication and SCIM for create/update/deactivate/delete lifecycle operations.

## Endpoint

Use this base URL:

```text
https://YOUR_OPSKNIGHT_URL/api/scim/v2
```

Users collection:

```text
https://YOUR_OPSKNIGHT_URL/api/scim/v2/Users
```

## Authentication

Configure a high-entropy bearer token in the OpsKnight environment:

```text
SCIM_BEARER_TOKEN=<at-least-32-character-random-secret>
```

Identity providers must send:

```http
Authorization: Bearer <SCIM_BEARER_TOKEN>
```

OpsKnight rejects missing/short configured tokens and performs timing-safe comparison of the supplied bearer token.

Generate a token with a cryptographically secure secret generator, for example:

```bash
openssl rand -hex 32
```

Store the token in the identity provider's SCIM connector and in your production secret manager. Do not commit it to source control.

## Supported resource

OpsKnight v1.5 supports the SCIM core User schema:

```text
urn:ietf:params:scim:schemas:core:2.0:User
```

Supported operations:

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `GET` | `/Users` | List/search SCIM-managed users. |
| `POST` | `/Users` | Provision a user. |
| `GET` | `/Users/{id}` | Read one SCIM resource. |
| `PUT` | `/Users/{id}` | Replace supported user attributes. |
| `PATCH` | `/Users/{id}` | Apply supported replace operations. |
| `DELETE` | `/Users/{id}` | Deprovision the SCIM resource. |

OpsKnight currently implements **Users**, not SCIM Groups. Group-to-role lifecycle should therefore be designed around your OIDC role mapping or provider-side user provisioning policy rather than assuming a `/Groups` endpoint exists.

## Supported user attributes

OpsKnight serializes the following main fields:

| SCIM field | OpsKnight meaning |
| --- | --- |
| `id` | Stable OpsKnight user ID used as the SCIM resource ID. |
| `externalId` | Stable external provisioning identifier. |
| `userName` | User email address. |
| `displayName` | User display name. |
| `emails` | Primary work email representation. |
| `active` | Whether the OpsKnight account is active. |

`externalId` is immutable for an existing SCIM resource.

## Filtering

The Users collection supports equality filtering for:

```text
externalId eq "..."
userName eq "..."
```

Unsupported filter forms return an error rather than being silently reinterpreted.

## Provisioning behavior

When the identity provider creates a SCIM user, OpsKnight records the external provisioning identity and marks the account role source as SCIM-managed where applicable.

Use a stable `externalId` from the identity platform. Do not recycle one person's external ID for another person.

## Updating a user

`PUT` can update supported replacement fields such as email, display name, and active state.

`PATCH` currently supports replace-style operations for supported paths such as:

```text
active
displayName
```

Unsupported operations/paths fail explicitly.

Security-sensitive state changes use the same administrative invariants as normal OpsKnight account management.

## Deprovisioning and DELETE

Setting `active=false` disables the OpsKnight account and invalidates active access according to the account/session security policy.

`DELETE /Users/{id}` intentionally does **not** physically erase the underlying OpsKnight user record. Instead OpsKnight:

1. disables the internal account;
2. invalidates sessions by advancing the user's security/session version;
3. clears the SCIM external identity so the resource disappears from the SCIM namespace; and
4. retains the disabled internal account for audit/history and operational references.

A later `GET /Users/{id}` therefore no longer exposes that account as the same SCIM-managed resource after successful SCIM deletion.

## OIDC and SCIM together

Recommended enterprise model:

```text
OIDC -> authentication
SCIM -> provisioning/deprovisioning
```

OIDC identities remain based on `(issuer, sub)`. SCIM lifecycle identity uses the SCIM resource/external ID. Do not assume that matching email addresses alone are sufficient to rewrite OIDC identity ownership.

When a user is deprovisioned through SCIM, session invalidation is intended to take effect without waiting for the previous OIDC JWT lifetime to expire.

## Role ownership

OpsKnight tracks whether a role is managed manually, by OIDC, or by SCIM. This avoids treating all role changes as equivalent.

If OIDC role mapping is authoritative for a deployment, document how it interacts with SCIM provisioning so administrators know whether role changes should be made in the IdP token claims or through the provisioning system.

## Microsoft Entra provisioning

In Microsoft Entra ID:

1. Configure the enterprise application's provisioning mode for SCIM.
2. Set the tenant URL to:

   ```text
   https://YOUR_OPSKNIGHT_URL/api/scim/v2
   ```

3. Set the secret token to the value of `SCIM_BEARER_TOKEN`.
4. Test the connection.
5. Map a stable source identifier to `externalId`, email to `userName`, display name to `displayName`, and account enabled state to `active`.
6. Start with a small assigned test group before broad rollout.

OIDC and Entra provisioning are separate connections: the Entra OIDC client secret is not the SCIM bearer token.

## Okta provisioning

For an Okta SCIM integration:

1. Use the same SCIM base URL:

   ```text
   https://YOUR_OPSKNIGHT_URL/api/scim/v2
   ```

2. Use HTTP Header/Bearer authentication with `SCIM_BEARER_TOKEN`.
3. Enable the user lifecycle capabilities required by your deployment.
4. Map a stable Okta identity to `externalId`.
5. Verify create, update, deactivate, and delete behavior with test users before production rollout.

## Operational checks

Before enabling automatic provisioning broadly, verify:

- bearer authentication rejects missing/wrong tokens;
- create produces one SCIM resource;
- repeated lookup by `externalId`/`userName` identifies the expected resource;
- update changes only supported fields;
- deactivation prevents access and invalidates sessions;
- DELETE returns success, removes the resource from the SCIM namespace, and keeps the internal disabled account for history;
- re-provisioning follows the intended account recovery/new-resource policy;
- at least two non-SCIM-dependent Admin recovery paths are understood.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `401` from every request | `SCIM_BEARER_TOKEN` is set, at least 32 characters, and the IdP sends `Authorization: Bearer ...`. |
| User lookup fails | Confirm the resource is still SCIM-managed and verify the `externalId` or `userName` filter. |
| `409` on update | Check immutable `externalId`, duplicate email/external identity, and account invariants. |
| DELETE succeeds but user still exists in OpsKnight | Expected: the internal account is retained disabled for history while the SCIM external identity is removed. |
| User still has a browser session after offboarding | Verify the SCIM operation completed and inspect account/session audit events. |
| Provider expects SCIM Groups | OpsKnight v1.5 does not expose a Groups resource; use OIDC role mapping or provider-side assignment policy. |

## Related topics

- [OIDC SSO Setup](./oidc-setup.md)
- [Authentication](../administration/authentication.md)
- [Users](../core-concepts/users.md)
- [Authorization and Roles](./authorization.md)
- [Configuration Reference](../getting-started/configuration.md)
