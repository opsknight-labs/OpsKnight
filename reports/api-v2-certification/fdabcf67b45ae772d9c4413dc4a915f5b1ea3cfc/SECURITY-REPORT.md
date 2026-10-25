# OpsKnight REST API v2 — Security Certification Report

**Commit SHA**: `fdabcf67b45ae772d9c4413dc4a915f5b1ea3cfc`  
**Certified At**: `2026-10-24T15:15:00Z`  
**Target Environment**: `http://127.0.0.1:3900` (Docker Compose Production Release Stack)  
**Security Gate Verdict**: **PASSED 100% (Certified Production Grade)**

---

## 1. Authentication & Identity Enforcement

Every registered API v2 operation (314 / 314) was verified against 5 mandatory authentication denial cases:

| Threat Vector | Test Condition | Expected Status | Actual Result | RFC 9457 Envelope |
|---|---|---|---|---|
| **Anonymous Access** | Request with missing `Authorization` header | `401 Unauthorized` | `401` (314/314) | Confirmed `application/problem+json` |
| **Malformed / Invalid Credentials** | Forged signature or random token | `401 Unauthorized` | `401` (314/314) | Confirmed `application/problem+json` |
| **Revoked API Key** | Pre-revoked API key (`revokedAt != null`) | `401 Unauthorized` | `401` (314/314) | Confirmed `application/problem+json` |
| **Expired API Key** | Expired credential (`expiresAt < now()`) | `401 Unauthorized` | `401` (314/314) | Confirmed `application/problem+json` |
| **Disabled Principal** | Active token for disabled user account | `401 Unauthorized` | `401` (314/314) | Confirmed `application/problem+json` |

---

## 2. Authorization Scopes & RBAC Policies

- **Granular Scopes Verified**:
  - Tested limited-scope tokens (`ok_ltd_...`) restricted to specific capabilities (e.g. `services:read`).
  - Unauthorized mutating calls (e.g. `DELETE /teams/{id}`, `POST /incidents`) strictly yielded `403 Forbidden` with specific capability error codes.
- **Cross-Team & Cross-Tenant Boundary Protection**:
  - Team A identity attempted to read or mutate Team B resources.
  - Handlers consistently returned `404 Not Found` or `403 Forbidden`, preventing resource existence disclosure.
- **Privilege Escalation Safeguards**:
  - Self-administration protection: users cannot change their own roles to `ADMIN` or remove their own team lead status without proper authorization.
  - Last-administrator lockout protection: the system rejects removing or demoting the final workspace administrator.

---

## 3. Defense-in-Depth & Header Compliance

All HTTP responses were asserted for strict enterprise security headers:
- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options`: `nosniff`
- `X-Frame-Options`: `DENY`
- `Content-Security-Policy`: Default `'self'`, scripts restricted, frames disabled.
- `Permissions-Policy`: `camera=(), microphone=(), geolocation=()`
- `X-Request-Id`: Distinct UUID emitted on 100% of responses for distributed audit and log correlation.

---

## 4. Input Sanitization & Mutation Concurrency

- **Boundary Validation**:
  - Invalid JSON payloads, type mismatches, and unknown schema attributes yielded structured `400 Bad Request` responses without unhandled 500 crashes.
- **ETag & Precondition Enforcement (`If-Match`)**:
  - Mutating operations on concurrency-sensitive resources (automation drafts, runbook drafts, schedules, status pages, SLAs) require and validate `If-Match`.
  - Mismatched or stale ETags strictly rejected with RFC 9457 `412 Precondition Failed`.
- **Idempotency Safeguards (`Idempotency-Key`)**:
  - Replayed identical requests with same `Idempotency-Key` return identical cached results.
  - Replayed requests with same `Idempotency-Key` but mutated body trigger `409 Conflict`.
