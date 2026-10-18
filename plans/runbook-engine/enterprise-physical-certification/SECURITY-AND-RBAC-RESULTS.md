# OpsKnight Runbook Engine — Security & RBAC Results

## 1. Threat Model & RBAC Boundaries

The OpsKnight security model enforces strict multi-tenant and role-based access control across 5 primary roles: `ADMIN`, `RESPONDER`, `OPERATOR`, `VIEWER`, and unauthenticated actors.

All authorization checks are enforced server-side via Server Actions and API middleware (`src/lib/runbooks/agent-auth.ts`, `src/app/actions/runbook-actions.ts`).

---

## 2. Security Test Matrix

| Security Scenario                               | Expected Enforcement                                 | Test Method                            | Outcome  |
| ----------------------------------------------- | ---------------------------------------------------- | -------------------------------------- | :------: |
| **1. Unauthorized Runbook Create/Edit/Archive** | Blocked with 403 Forbidden                           | Server Action RBAC unit tests          | **PASS** |
| **2. Unauthorized Service Rule Activation**     | Blocked with 403 Forbidden                           | `service-rule-management-rbac.test.ts` | **PASS** |
| **3. Non-responder Approving Sensitive Gate**   | Blocked; requires `RESPONDER`+                       | Incident RBAC suite                    | **PASS** |
| **4. Tampered Execution Envelope**              | Cryptographic signature mismatch rejected            | `execution-signing.test.ts`            | **PASS** |
| **5. Expired / Replayed Request Nonce**         | Replay rejected; nonce cache checked                 | Agent protocol validation              | **PASS** |
| **6. Agent Token Expiration (15m window)**      | Expired tokens rejected with 400                     | `agent-auth.test.ts`                   | **PASS** |
| **7. Agent Revocation Fencing**                 | Revoked agent immediately drained & disconnected     | UI Agent revocation drill              | **PASS** |
| **8. SSRF via HTTP Step**                       | Loopback (127.0.0.1) & RFC1918 IPs rejected          | HTTP executor URL validation           | **PASS** |
| **9. Bash Command Injection**                   | Shell metacharacters escaped; strict allowlist       | Agent bash executor test               | **PASS** |
| **10. Secret Masking in Serialized Logs**       | Passwords in URIs, tokens & headers redacted         | Structured logger sanitization tests   | **PASS** |
| **11. Database Error Sanitization**             | Raw database exceptions hidden from client           | `check-rule-policy-action.test.ts`     | **PASS** |
| **12. Kubernetes RBAC Breakout**                | Scoped ServiceAccount prevents cluster-admin actions | Kind in-cluster agent test             | **PASS** |

---

## 3. Logger Credential Sanitization Verification

In compliance with security hardening requirements, `src/lib/logger.ts` was verified to redact passwords embedded in PostgreSQL connection strings, including internal hostnames:

```typescript
// Verified pattern matches:
// postgresql://user:password@localhost:5432/db -> postgresql://user:[REDACTED]@localhost:5432/db
// postgresql://user:password@db:5432/db -> postgresql://user:[REDACTED]@db:5432/db
```

Regression tests in `tests/lib/logger-redaction.test.ts` verify that serialized JSON log streams contain zero plain-text credentials.
