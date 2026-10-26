# OpsKnight 2.1 — Production Release Certification Executive Summary

**Release Candidate:** OpsKnight 2.1.0  
**Commit SHA:** `abede9203d257fafeff8c4d19ef23dc269bc8274`  
**Certification Period:** 2026-10-25 – 2026-10-26  
**Final Release Decision:** **CONDITIONAL GO**

---

## 1. Release Scorecard

| Certification Domain            | Scope Evaluated                                                     | Physical Evidence                                        | Status             |
| ------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- | ------------------ |
| **Phase 0: Candidate Baseline** | Commit `abede9203d`, route tree, 12 core domains                    | `FEATURE-AND-ROUTE-MATRIX.md`                            | **PASSED**         |
| **Phase 1: Disaster Recovery**  | Full PostgreSQL 16 dump, clean container restore, RPO/RTO           | `BACKUP-RESTORE-REPORT.md` (RTO: 11.4s, RPO: 0s)         | **PASSED**         |
| **Phase 2: Upgrade & Rollback** | v2.0.0 → v2.1.0 (318 migrations), data preservation, rollback drill | `UPGRADE-CERTIFICATION.md`, `ROLLBACK-REHEARSAL.md`      | **PASSED**         |
| **Phase 3: Product E2E**        | Journeys A–G (Ingestion, Automation, Escalation, Runbooks, Status)  | `FULL-PRODUCT-E2E-CERTIFICATION.md` (40/40 steps passed) | **PASSED**         |
| **Phase 4: UI & Accessibility** | 7 viewports (375px–1920px), Chrome/FF/WebKit, modal Escape          | `UI-ROUTE-MATRIX.md`, `COMPONENT-CERTIFICATION.md`       | **PASSED**         |
| **Phase 5: Resilience & HA**    | Multi-replica (2x & 4x), in-flight chaos, instant token revocation  | `RESILIENCE-AND-HA-CERTIFICATION.md` (100% passed)       | **PASSED**         |
| **Phase 6: Security & RBAC**    | Cross-tenant isolation, negative auth, CSP, CodeQL, SBOM            | `RELEASE-SECURITY-AUDIT.md` (0 High/Critical findings)   | **PASSED**         |
| **Phase 7: Deployments**        | Compose (integrated/split), Docker Swarm, Kubernetes Helm           | `DEPLOYMENT-CERTIFICATION.md`                            | **PASSED**         |
| **Phase 8: Packaging & Gates**  | Defect register, scope boundaries, release packaging                | `DEFECT-REGISTER.md`, `FINAL-GO-NO-GO.md`                | **CONDITIONAL GO** |

---

## 2. Key Findings & Discoveries

1. **Runbook CI Blocker Resolved (P0):**
   - The detached-rule browser test failure across Chromium, Firefox, and WebKit was diagnosed as a copy mismatch resulting from UI compaction in PR #904 (`Rule detached · Archived history` vs legacy string).
   - Resolved in **[PR #916](https://github.com/opsknight-labs/OpsKnight/pull/916)** and merged to `main`.
2. **Disaster Recovery Script Finding (P1):**
   - `deploy/scripts/drills/verify-backup-restore.sh` hardcoded `postgres:15-alpine`. When auditing PostgreSQL 16 custom archives, it produced `unsupported version (1.15)`. Verified that running with `postgres:16-alpine` restores cleanly in **7.0 seconds**.
3. **Multi-Replica State Synchronization:**
   - In-flight container crash injection during 40 active requests produced zero failed requests as Nginx retried on healthy replicas.
   - Database-backed immediate token revocation propagated instantaneously across all 4 replicas.
4. **Realtime UI/API Parity:**
   - Verified that browser mutations (such as acknowledging or resolving an incident) synchronize bidirectionally with REST API v2 and PostgreSQL with zero state delay.

---

## 3. Release Recommendation

The candidate has met all functional, reliability, security, and disaster-recovery release gates. Tagging of `v2.1.0` should proceed as soon as PR #915 (live incident command center) reaches its inclusion or deferral milestone.
