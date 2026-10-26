# OpsKnight 2.1 — Release Security Audit & Authorization Certification

**Candidate Commit SHA:** `3d2432a81fc276612540261f0fb173527b0d7343`  
**Security Clearance:** APPROVED FOR RELEASE  
**Audit Date:** 2026-10-26  
**Auditor:** Senior Security Architect & Application Security Reviewer

---

## 1. Authorization & Cross-Tenant Boundary Certification

Using `scripts/certification/certify-authorization-isolation.ts`, all negative authorization paths and cross-tenant boundaries were physically audited against live database instances:

| Security Scenario         | Attacker Context   | Target Action                       | Expected Result       | Actual Result                   | Database Side-Effect Check            |
| ------------------------- | ------------------ | ----------------------------------- | --------------------- | ------------------------------- | ------------------------------------- |
| **Cross-Team Mutation**   | Team A Credential  | `PATCH /services/{teamBServiceId}`  | HTTP 403 Forbidden    | HTTP 403 Forbidden              | **PASS** (Zero DB mutations)          |
| **Cross-Team Deletion**   | Team A Credential  | `DELETE /services/{teamBServiceId}` | HTTP 403 Forbidden    | HTTP 403 Forbidden              | **PASS** (Team B service retained)    |
| **Auditor Role Mutation** | Read-Only Auditor  | `POST /incidents`                   | HTTP 403 Forbidden    | HTTP 403 Forbidden              | **PASS** (Zero incidents created)     |
| **Privilege Escalation**  | Regular User       | `POST /users/invitations`           | HTTP 403 Forbidden    | HTTP 403 Forbidden              | **PASS** (Zero admin invites created) |
| **Disabled User Lockout** | Disabled Principal | `GET /incidents`                    | HTTP 401 Unauthorized | HTTP 401 Unauthorized           | **PASS** (Zero queries executed)      |
| **Scope Boundary Check**  | Read-Only Token    | `POST /incidents`                   | HTTP 403 Forbidden    | HTTP 403 (`API_SCOPE_REQUIRED`) | **PASS** (Zero writes permitted)      |

---

## 2. Cryptographic Architecture & Secret Isolation

1. **At-Rest Secret Encryption:**
   - Provider secrets, OAuth tokens, and webhook signing secrets are encrypted with authenticated `AES-256-GCM` via `ENCRYPTION_KEY`.
   - Initialization vectors (IVs) and authentication tags are stored per-record.
   - Decryption occurs only in ephemeral worker memory; secrets are strictly redacted in API outputs, logs, and error responses.
2. **API Key & Session Token Hashing:**
   - Modern API keys are hashed with HMAC-SHA256 (`API_KEY_SECRET`), completely decoupling token verification from user password KDF cost.
   - User passwords utilize `bcrypt` with work factor 10.
   - JWT sessions are signed with `NEXTAUTH_SECRET` and encrypted in transport via `__Host-` and `__Secure-` cookie prefixes.
3. **HTTP Security Headers & CSP:**
   - Production responses enforce:
     - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
     - `X-Content-Type-Options: nosniff`
     - `X-Frame-Options: DENY`
     - `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none';`
     - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## 3. Automated Security Tooling & SBOM Pipeline

| Security Check                       | Tool / Engine                           | Target / Scope                     | Result                                            |
| ------------------------------------ | --------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| **SAST (Code Analysis)**             | GitHub CodeQL (JavaScript & TypeScript) | Full source repository             | **PASS (0 High/Critical alerts)**                 |
| **SCA (Dependency Vulnerabilities)** | npm audit & Dependabot                  | Production dependencies            | **PASS (Non-breaking security patch in PR #913)** |
| **Container & OS Vulnerabilities**   | Trivy Container Scanner                 | Production Docker image            | **PASS**                                          |
| **IaC & Manifest Security**          | Checkov                                 | Docker Compose, Swarm, Helm charts | **PASS**                                          |
| **Secret Scanning**                  | GitGuardian / GitHub Secret Scanning    | Commit history & test fixtures     | **PASS (Zero production secrets leaked)**         |
| **SBOM Compliance**                  | CycloneDX / SPDX generator              | Validated artifact metadata        | **PASS (SBOM verified in CI)**                    |

---

## 4. Enterprise Identity (SSO & SCIM) Integration

- **SCIM 2.0:** Validated RFC 7644 conformity in PR #906 and #909 (`GET /api/scim/v2/Users`, `GET /api/scim/v2/Groups`, `GET /api/scim/v2/ServiceProviderConfig`).
- **SSO:** Verified SAML 2.0 / OIDC provider flows, domain-level routing, and password admission policies.
