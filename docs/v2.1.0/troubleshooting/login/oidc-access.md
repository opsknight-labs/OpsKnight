---
title: OIDC login succeeds but access is wrong
description: Diagnose account linking, role mapping, provisioning, and stale session access.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify oidc access.
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/oidc.ts, src/lib/auth.ts]
---

# OIDC login succeeds but access is wrong

Inspect the linked user, issuer and subject, controlled role claim, role source,
active status, and team scope. Compare the current provider claims with the stored
mapping policy. Revoke or refresh the session after correcting policy. Do not
grant a broader local role merely to compensate for a broken claim mapping.

## Isolate authentication from authorization

1. Confirm the callback completed and record issuer, subject, and user ID.
2. Verify the linked account is active and that issuer/subject match exactly.
3. Compare the current role/team claims with the configured mapping rules.
4. Inspect whether the role source is OIDC, SCIM, or locally controlled.
5. End the existing session and authenticate again after changing mappings.

Classify the symptom before changing a role:

| Symptom | Inspect |
| --- | --- |
| a second user was created | normalized issuer, subject, email-linking policy |
| login works but role is too low/high | role claim value, mapping rule, role source |
| role is right but team data is absent | team/group claims and resource membership |
| disabled user can still act | account status and session issued before disablement |
| changes appear only after signing out | session claim/cache lifetime |

Decode a test token only in an approved local tool and never paste it into a
ticket. Compare the issuer exactly, including scheme and path; compare `sub` as an
opaque string; confirm the configured claim name and whether its value is a
string or array. Email is not a safe substitute for issuer plus subject unless
the configured linking policy explicitly permits it.

When OIDC and SCIM both manage the account, determine ownership before editing:
SCIM may control activation and group membership while OIDC supplies the login
identity. A local edit can be overwritten at the next provisioning cycle.

If no user is linked, diagnose provisioning or linking. If the correct user is
linked but permissions are wrong, diagnose mapping and resource scope. If a new
session still contains old access, inspect provider claim freshness and session
cache configuration.

Verify with a least-privileged test account against one allowed and one denied
operation. Preserve redacted claims, issuer, subject hash, mapping rule, role
source, and request ID; never collect tokens or client secrets.
