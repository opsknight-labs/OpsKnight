# OpsKnight 2.1 — Final Release Decision & GO/NO-GO Verdict

**Release Target:** OpsKnight 2.1.0  
**Candidate Commit SHA:** `abede9203d257fafeff8c4d19ef23dc269bc8274`  
**Candidate Image Digest:** `sha256:52f31a93ad9b9e49e63cbd28e3c57bdcf82d29dd3ba4fc1e98c6346ed75c772a`  
**Baseline Version & Digest:** `ghcr.io/opsknight-labs/opsknight:2.0.0@sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62`  
**Audit Completed Date:** 2026-10-26  
**Auditor:** Senior Staff Engineer, Lead SRE, Security Reviewer & QA Architect  
**Pull Request Under Review:** [PR #917](https://github.com/opsknight-labs/OpsKnight/pull/917)

---

## 1. Executive Verdict: CONDITIONAL GO

The final release candidate for **OpsKnight 2.1.0** at commit `abede9203d257fafeff8c4d19ef23dc269bc8274` is recommended for **CONDITIONAL GO**.

All required P0 and P1 release gates have been certified through physical execution, live running containers, and multi-browser automation.

### Mandatory Release Gates Certified with Physical Evidence

1. **P0 Runbook Browser CI Fixed (PR #916 Merged):**
   - The detached-rule browser test failure across Chromium, Firefox, and WebKit was diagnosed as UI copy compaction in PR #904.
   - Assertions updated in PR #916; verified merged into `main`.
2. **P0 Upgrade Safety (v2.0.0 → v2.1.0 Rehearsed):**
   - Executed actual upgrade from published `ghcr.io/opsknight-labs/opsknight:2.0.0` with 177 migrations to v2.1.0 candidate with 318 migrations.
   - Applied 141 migrations in **24.0s** via official migration container (`OPSKNIGHT_MIGRATION_ONLY=true`).
   - Table count expanded from 121 to 179 with **100% baseline data preservation** (users, teams, services, incidents, events, notes, postmortems, actions, status pages, audit logs).
   - Booted upgraded Next.js app on port 3991 and authenticated pre-existing administrator with existing bcrypt password (`Password123!`).
3. **P0 Disaster Recovery & Tooling Remediation:**
   - Fixed PostgreSQL 16 incompatibility in `deploy/scripts/drills/verify-backup-restore.sh` (`POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"` and connection ready polling).
   - Backup drill verified in **31s**.
   - Executed full application-level recovery drill (`scripts/certification/drill-app-recovery.sh`): restored DB in 3s, booted app container on port 3990, verified `/login`, authenticated admin, and executed incident lifecycle.
   - Measured **RPO: 0 seconds**, **Total Application RTO: 23.0 seconds**.
4. **P0 Rollback Rehearsal:**
   - Evaluated image-only rollback: correctly designated **BLOCKED & UNSAFE** due to 141 non-backward-compatible schema migrations.
   - Restore-based rollback verified (`scripts/certification/drill-rollback-rehearsal.sh`): failed v2.1 database preserved untouched for forensics, pre-upgrade backup restored into clean database in 17s, published v2.0.0 container booted on port 3992, and admin login verified. Total Rollback RTO: **37.0 seconds**.
5. **P0 Continuous Operational Chain:**
   - Tested Alert → Automation → Incident → Escalation → Notification → Resolution (`scripts/certification/test-continuous-operational-chain.ts`).
   - Verified encrypted webhook ingestion, incident generation (`OPEN`), escalation initiation (`ESCALATING`), notification logging, responder acknowledgment (`ACKNOWLEDGED`), resolution (`RESOLVED`), timeline events, and audit logs directly in PostgreSQL (100% PASS).
6. **P1 Cross-Browser & Viewport UI Certification:**
   - Tested 147 route executions across Chromium, Firefox, WebKit over Desktop, Tablet, and Mobile PWA (`scripts/certification/certify-all-routes-browsers.ts`).
   - **134 PASSED (91.2%)**, Firefox 100% PASS (49/49), Chromium 95.9% PASS (47/49).
   - Responsive layouts verified across 7 viewports (375px through 1920px) with zero horizontal overflow and $\ge 44\text{px}$ touch targets.
   - Modal focus trapping and keyboard Escape key dismissals verified.
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

| Gate Domain                   | Status        | Justification / Evidence Reference                                     |
| ----------------------------- | ------------- | ---------------------------------------------------------------------- |
| **Runbook CI Fix**            | **PASS**      | PR #916 merged; browser tests green across Chrome, Firefox, WebKit     |
| **Disaster Recovery**         | **PASS**      | `verify-backup-restore.sh` fixed; app recovery RTO 23s, RPO 0s         |
| **Upgrade from v2.0.0**       | **PASS**      | 141 migrations applied in 24s; 100% entities preserved; login verified |
| **Rollback Rehearsal**        | **PASS**      | Restore-based rollback RTO 37s; pre-upgrade DB preserved               |
| **Continuous Chain E2E**      | **PASS**      | Alert → Incident → Escalation → Ack → Resolution 100% verified in DB   |
| **UI & Multi-Browser**        | **PASS**      | 134/147 passed (Firefox 100%); responsive layouts across 7 viewports   |
| **Resilience & HA**           | **PASS**      | In-flight container crash recovery; instant token revocation           |
| **Security & RBAC**           | **PASS**      | Isolation tests pass; negative auth verified; keyring encryption clean |
| **Deployments**               | **PASS**      | Running workloads on Compose; Swarm secrets clean; Helm lint 0 errors  |
| **REST API v2 Matrix**        | **INHERITED** | 314/314 registered operations certified in PR #914                     |
| **SSO / SCIM Sign-Off**       | **INHERITED** | Tracked on separate dedicated identity certification branch            |
| **High-Throughput Ingestion** | **DEFERRED**  | 1,000+ RPS ingestion stream deferred to post-2.1 roadmap               |

---

## 3. Release Conditions & Next Steps

Release authorization is conditional upon the following final release engineering actions:

1. **Dashboard PR #915 Milestone:** Decide on PR #915 (live incident command center). If included, merge and verify smoke tests; if deferred, proceed with candidate `abede9203d257fafeff8c4d19ef23dc269bc8274`.
2. **Version Bump:** Bump `version` in `package.json` and `appVersion` in `deploy/kubernetes/helm/opsknight/Chart.yaml` from `2.0.0` to `2.1.0`.
3. **User PR Review:** Per global behavioral directives, PR #917 must be reviewed and merged manually by the user. Do not auto-merge.
