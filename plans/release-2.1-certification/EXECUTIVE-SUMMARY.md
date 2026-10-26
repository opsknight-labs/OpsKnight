# OpsKnight 2.1 — Production Release Certification Executive Summary

**Release Candidate:** OpsKnight 2.1.0  
**Commit SHA:** `3d2432a81fc276612540261f0fb173527b0d7343`  
**Candidate Image Digest:** `sha256:52f31a93ad9b9e49e63cbd28e3c57bdcf82d29dd3ba4fc1e98c6346ed75c772a`  
**Baseline Version & Digest:** `ghcr.io/opsknight-labs/opsknight:2.0.0@sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62`  
**Certification Date:** 2026-10-26  
**Final Release Decision:** **CONDITIONAL GO**  
**Pull Request Under Review:** [PR #917](https://github.com/opsknight-labs/OpsKnight/pull/917)

---

## 1. Release Gate Scorecard

| Certification Domain            | Scope Evaluated                                                            | Physical Evidence & Verification Metric                                          | Status             |
| ------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------ |
| **Phase 0: Candidate Baseline** | Commit `3d2432a81f`, route tree, 12 core domains                           | `FEATURE-AND-ROUTE-MATRIX.md`                                                    | **PASSED**         |
| **Phase 1: Disaster Recovery**  | PostgreSQL 16 fix in `verify-backup-restore.sh`, full app recovery drill   | `BACKUP-RESTORE-REPORT.md` (Measured RPO: 0s, RTO: 35s, HTTP API probe + worker) | **PASSED**         |
| **Phase 2: Upgrade & Rollback** | Real v2.0.0 → v2.1.0 (177 → 318 migrations), data preservation, rollback   | `UPGRADE-CERTIFICATION.md`, `ROLLBACK-REHEARSAL.md` (100% asserted)              | **PASSED**         |
| **Phase 3: Product E2E**        | Continuous chain (Alert → Incident → Escalation → Ack → Resolution) & A–G  | `FULL-PRODUCT-E2E-CERTIFICATION.md` (100% application-driven via API v2)         | **PASSED**         |
| **Phase 4: UI & Multi-Browser** | 153 test runs across Chrome, Firefox, WebKit (Desktop, Tablet, Mobile PWA) | `UI-ROUTE-MATRIX.md`, `COMPONENT-CERTIFICATION.md` (153 / 153 PASS - 100.0%)     | **PASSED**         |
| **Phase 5: Resilience & HA**    | 2x Web replicas, Nginx proxy, in-flight crash chaos, token revocation      | `RESILIENCE-AND-HA-CERTIFICATION.md` (0 failed requests under chaos)             | **PASSED**         |
| **Phase 6: Security & RBAC**    | Cross-tenant isolation, negative auth, CSP, CodeQL, SBOM                   | `RELEASE-SECURITY-AUDIT.md` (0 High/Critical findings)                           | **PASSED**         |
| **Phase 7: Deployments**        | Compose (integrated & split running workloads), Swarm secrets, Helm lint   | `DEPLOYMENT-CERTIFICATION.md`                                                    | **PASSED**         |
| **Inherited: REST API v2**      | 314 registered operations, 31 capability families                          | Inherited from PR #914 certification                                             | **INHERITED**      |
| **Inherited: SSO / SCIM**       | Live identity provider certification                                       | Handled on separate dedicated identity branch                                    | **INHERITED**      |
| **Deferred: High-Throughput**   | 1,000+ RPS event ingestion stream                                          | Deferred to post-2.1 roadmap by steering committee                               | **DEFERRED**       |
| **Phase 8: Packaging & Gates**  | Defect register, scope boundaries, release packaging                       | `DEFECT-REGISTER.md`, `FINAL-GO-NO-GO.md`                                        | **CONDITIONAL GO** |

---

## 2. Key Remediations & Discoveries in PR #917

1. **Physical Upgrade Rehearsal from Published v2.0.0 Baseline:**
   - Ran actual migration from `ghcr.io/opsknight-labs/opsknight:2.0.0` (177 migrations) to v2.1.0 candidate (318 migrations).
   - Applied 141 migrations in **3.0s**. Verified 100% entity preservation with code-level assertions across all 10 entity families (users, teams, services, incidents, timeline notes, postmortems, action items, status pages, audit logs, and encrypted integrations). Referential integrity confirmed: 0 orphaned rows.
   - Verified specific entity identities and content integrity (Admin, Team, Service, Incident) and cryptographically verified programmatic decryption of `Integration.key` using the release candidate `ENCRYPTION_KEY`.
   - Upgraded application container booted on port 3991 and established active session for `admin@opsknight.internal` on `/api/auth/session` and protected `/` (HTTP 200).
2. **PostgreSQL 16 Disaster Recovery Tooling Fixed & Application Probe:**
   - `deploy/scripts/drills/verify-backup-restore.sh` hardcoded `postgres:15-alpine`, causing `unsupported version (1.15)` on PG 16 backups.
   - Updated script with `POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"` and connection-ready polling; verified clean restore in **31s**.
   - Performed complete application-level recovery drill: restored DB in 2s, booted both web and background worker containers on port 3990, verified `/login` readiness, authenticated admin, executed incident lifecycle **strictly via real HTTP APIs** (`POST /api/incidents/create` -> `PATCH /api/incidents/:id/status`), and confirmed background worker active queue processing (Measured **RPO: 0s** relative to snapshot point-in-time, **Total Application RTO: 35s** cold-start on baseline data).
3. **Safe Restore-Based Rollback Rehearsed:**
   - Verified that image-only rollback is unsafe due to 141 non-backward-compatible schema migrations.
   - Rehearsed restore-based rollback without dropping existing databases: preserved failed v2.1 DB for forensics, restored backup into clean database in 3s, booted published v2.0.0 container on port 3992, and authenticated admin with session verification on `/api/auth/session` (Total Rollback RTO: **38s**). Corrected invalid digest documentation.
4. **Continuous Operational Chain Verified (100% Real Application Enforced):**
   - Exercised continuous lifecycle against running cluster: Prometheus Webhook Alert -> Incident Created (`OPEN`) -> Escalation Initiated (`ESCALATING`) -> Mandatory 4-Stage Notification Lifecycle Verified (Queued -> Attempted -> Provider-Accepted -> Delivered to in-app receiver) -> Runbook Preview API -> Worker Orchestration Execution (`POST /api/v2/runbooks/:id/execute`) verified on background worker to `SUCCEEDED` -> Responder Acknowledgment (`ACKNOWLEDGED`) via `POST /api/v2/incidents/:id/acknowledge` -> Resolution (`RESOLVED`) via `POST /api/v2/incidents/:id/resolve`. Verified timeline events and mandatory audit logs (`incident.acknowledged`, `incident.resolved`). Zero Prisma write bypasses or mock shortcuts.
5. **Real Authenticated Multi-Browser Coverage (100% PASS):**
   - Executed 153 test runs across Chromium, Firefox, WebKit across Desktop, Tablet, and Mobile viewports.
   - **153 PASSED (100.0%)**: Chromium 51/51 PASS, Firefox 51/51 PASS, WebKit 51/51 PASS. Enforced nonzero exit code safety, DOM mounted content verification, fail-closed modal focus/Escape dismissals, and deterministic mount hydration in `SystemHealthCenter.tsx`.
6. **Certification Script Isolation & Supported Cryptography:**
   - Resolved environment override bug in certification scripts. Replaced custom inline decipher snippets with OpsKnight's supported `decrypt()` module (v3/v2/v1 keyrings, fail-closed, zero plaintext leakage). Added safety guards `OPSKNIGHT_CERT_TARGET=1` to prevent running against non-disposable environments. Removed hardcoded fallback secrets. Incorporated PR #847 Swarm database secret resolver.

---

## 3. Release Recommendation & Prerequisites

OpsKnight 2.1.0 has met all core functional, reliability, security, and disaster-recovery release gates.

The release is **CONDITIONAL GO** pending:

1. PR #915 (Incident Command Center dashboard) is now merged and incorporated into the release baseline (`3d2432a81`).
2. Version bump in `package.json` and Helm chart from `2.0.0` to `2.1.0`.
3. User review and manual merge of [PR #917](https://github.com/opsknight-labs/OpsKnight/pull/917).
