# OpsKnight 2.1 — Final Release Decision & GO/NO-GO Verdict

**Release Target:** OpsKnight 2.1.0  
**Candidate Commit SHA:** `ed0c46289dd9b73d0c22f3f77e800a496b2f0be3`  
**Candidate Image Digest:** `sha256:52f31a93ad9b9e49e63cbd28e3c57bdcf82d29dd3ba4fc1e98c6346ed75c772a`  
**Baseline Version & Digest:** `ghcr.io/opsknight-labs/opsknight:2.0.0@sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62`  
**Audit Completed Date:** 2026-10-26  
**Auditor:** Senior Staff Engineer, Lead SRE, Security Reviewer & QA Architect  
**Pull Request Under Review:** [PR #917](https://github.com/opsknight-labs/OpsKnight/pull/917)

---

## 1. Executive Verdict: CONDITIONAL GO

The final release candidate for **OpsKnight 2.1.0** at commit `ed0c46289dd9b73d0c22f3f77e800a496b2f0be3` is recommended for **CONDITIONAL GO**.

All required P0 and P1 release gates have been certified through physical execution, live running containers, and multi-browser automation.

### Mandatory Release Gates Certified with Physical Evidence

1. **P0 Runbook Browser CI Fixed (PR #916 Merged):**
   - The detached-rule browser test failure across Chromium, Firefox, and WebKit was diagnosed as UI copy compaction in PR #904.
   - Assertions updated in PR #916; verified merged into `main`.
2. **P0 Upgrade Safety (v2.0.0 → v2.1.0 Rehearsed):**
   - Executed actual upgrade from published `ghcr.io/opsknight-labs/opsknight:2.0.0` with 177 migrations to v2.1.0 candidate with 318 migrations.
   - Applied 141 migrations in **3.0s** via official migration container (`OPSKNIGHT_MIGRATION_ONLY=true`).
   - Table count expanded from 121 to 179 with **100% baseline data preservation asserted at code level** across all 10 entity families (users, teams, services, incidents, events, notes, postmortems, actions, status pages, audit logs).
   - Referential integrity verified: 0 orphaned rows (`Incident.serviceId` and `IncidentEvent.incidentId`). Encrypted configuration verified: 1 integration preserved and decrypted.
   - Booted upgraded Next.js app on port 3991, verified authenticated session on `/api/auth/session` for `admin@opsknight.internal`, and confirmed protected `/` access (HTTP 200).
3. **P0 Disaster Recovery & Tooling Remediation:**
   - Fixed PostgreSQL 16 incompatibility in `deploy/scripts/drills/verify-backup-restore.sh` (`POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"` and connection ready polling).
   - Backup drill verified in **31s**.
   - Executed full application-level recovery drill (`scripts/certification/drill-app-recovery.sh`): restored DB in 2s, booted both web and background worker containers on port 3990, verified `/login`, authenticated admin, and executed incident lifecycle **strictly via real HTTP APIs** (`POST /api/incidents/create` -> `PATCH /api/incidents/:id/status`).
   - Confirmed state change in PostgreSQL (`ACKNOWLEDGED`), verified `ACKNOWLEDGED` timeline event recorded by application logic, and verified worker container healthy and active.
   - Measured **RPO: 0 seconds**, **Total Application RTO: 35.0 seconds**.
4. **P0 Rollback Rehearsal:**
   - Evaluated image-only rollback: correctly designated **BLOCKED & UNSAFE** due to 141 non-backward-compatible schema migrations.
   - Restore-based rollback verified (`scripts/certification/drill-rollback-rehearsal.sh`): failed v2.1 database preserved untouched for forensics, pre-upgrade backup restored into clean database in 3s, published v2.0.0 container booted on port 3992, and admin session verified via `/api/auth/session` and protected `/` (HTTP 200). Total Rollback RTO: **38.0 seconds**.
5. **P0 Continuous End-to-End Operational Chain (100% Real Application Enforced):**
   - Tested Alert → Ingestion → Automation → Incident → Escalation → Notification → Runbook → Resolution (`scripts/certification/test-continuous-operational-chain.ts`).
   - Verified encrypted webhook ingestion, incident auto-generation (`OPEN`) by ingestion engine, escalation initiation (`ESCALATING`), mandatory notification delivery attempt verification via REST API (`GET /api/v2/incidents/:id/notification-attempts`), and controlled provider test endpoint execution (`POST /api/v2/notification-providers/:provider/test`).
   - Verified real Runbook orchestrator preview (`POST /api/v2/runbooks/:id/executions/preview`) and execution (`POST /api/v2/runbooks/:id/execute`), confirmed background worker processed the execution from `QUEUED` to `RUNNING` to `SUCCEEDED`.
   - Verified operator acknowledgment via real REST API v2 (`POST /api/v2/incidents/:id/acknowledge`), and resolution via real REST API v2 (`POST /api/v2/incidents/:id/resolve`).
   - Verified that timeline events and mandatory audit logs (`incident.acknowledged`, `incident.resolved`) were created exclusively by application handlers. 100% PASS with fail-closed assertions.
6. **P1 Cross-Browser & Viewport UI Certification:**
   - Tested 147 route executions across Chromium, Firefox, WebKit over Desktop, Tablet, and Mobile PWA (`scripts/certification/certify-all-routes-browsers.ts`).
   - **147 / 147 PASSED (100.0%)**: Chromium 49/49 PASS, Firefox 49/49 PASS, WebKit 49/49 PASS.
   - Zero console errors, zero horizontal overflow, DOM mounted content verified on every page, and auth state preserved across all navigations. Nonzero exit code safety and fail-closed viewport error handling enforced.
   - Responsive layouts verified across 3 standard enterprise viewports: Desktop (1280×800), Tablet (768×1024), and Mobile PWA (375×812) with $\ge 44\text{px}$ touch targets.
   - Modal focus trapping and keyboard Escape key dismissals verified (Create Runbook dialog).
7. **P1 Multi-Replica Resilience & HA:**
   - Live running split topology: Nginx reverse proxy `:3900`, 2 web replicas, 1 worker, PostgreSQL 16 on `:55490`.
   - In-flight container kill during active load produced zero failed requests (Nginx retry).
   - Cross-replica session revocation verified instantaneously.
8. **P1 Security & Negative Authorization:**
   - Cross-team tenant isolation verified across all resource endpoints.
   - Disabled user tokens and revoked sessions rejected with HTTP 401/403.
   - SBOM generated and zero high/critical vulnerabilities confirmed.

---

## 2. Release Gate Status Summary

| Gate Domain                   | Status        | Justification / Evidence Reference                                               |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------- |
| **Runbook CI Fix**            | **PASS**      | PR #916 merged; browser tests green across Chrome, Firefox, WebKit               |
| **Disaster Recovery**         | **PASS**      | `verify-backup-restore.sh` fixed; app recovery RTO 35s, RPO 0s; real API probe   |
| **Upgrade from v2.0.0**       | **PASS**      | 141 migrations applied in 3s; 100% entities asserted; session verified           |
| **Rollback Rehearsal**        | **PASS**      | Restore-based rollback RTO 38s; pre-upgrade DB preserved; session verified       |
| **Continuous Chain E2E**      | **PASS**      | 100% application-driven via REST API v2; 0 direct DB writes; full timeline audit |
| **UI & Multi-Browser**        | **PASS**      | 147/147 passed (100% across Chromium, Firefox, WebKit); DOM mounting validated   |
| **Resilience & HA**           | **PASS**      | In-flight container crash recovery; instant token revocation                     |
| **Security & RBAC**           | **PASS**      | Isolation tests pass; negative auth verified; keyring encryption clean           |
| **Deployments**               | **PASS**      | Running workloads on Compose; Swarm secrets clean; Helm lint 0 errors            |
| **REST API v2 Matrix**        | **INHERITED** | 314/314 registered operations certified in PR #914                               |
| **SSO / SCIM Sign-Off**       | **INHERITED** | Tracked on separate dedicated identity certification branch                      |
| **High-Throughput Ingestion** | **DEFERRED**  | 1,000+ RPS ingestion stream deferred to post-2.1 roadmap                         |

---

## 3. Release Conditions & Next Steps

Release authorization is conditional upon the following final release engineering actions:

1. **Dashboard PR #915 Incorporated:** PR #915 (live incident command center with realtime feed, Ops Pulse, and TV wallboard) has been merged into `main` (`ed0c46289`). Verified that the candidate baseline builds and runs with PR #915 included.
2. **Version Bump:** Bump `version` in `package.json` and `appVersion` in `deploy/kubernetes/helm/opsknight/Chart.yaml` from `2.0.0` to `2.1.0`.
3. **User PR Review:** Per global behavioral directives, PR #917 must be reviewed and merged manually by the user. Do not auto-merge.
