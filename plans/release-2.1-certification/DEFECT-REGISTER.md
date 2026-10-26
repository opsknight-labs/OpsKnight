# OpsKnight 2.1 — Release Defect & Vulnerability Register

**Audit Date:** 2026-10-26  
**Auditor:** QA Architecture, SRE & Release Engineering

---

## 1. Defect Severity Definitions

- **P0 (Release Blocker):** Data loss, corruption, broken core operational path, unrecoverable migration, or critical security bypass.
- **P1 (Operational Defect):** Broken secondary workflows, recovery script incompatibilities, or misleading operational status.
- **P2 (Non-Blocking / Scope Limitation):** Edge-case client timings, cosmetic defects, or documented feature scope deferrals.

---

## 2. Defect Register & Resolution Audit

| Defect ID   | Severity | Component                    | Summary & Impact                                                                              | Root Cause                                                                                                                                       | Resolution Status                                                                               |
| ----------- | -------- | ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **DEF-001** | **P0**   | Runbooks / E2E Suite         | Detached-rule browser tests failed across Chromium, Firefox, WebKit in CI                     | PR #904 compacted card UI copy to `"Rule detached · Archived history"` while `tests/e2e/runbooks-ui.spec.ts` asserted legacy verbose string.     | **RESOLVED & MERGED** (PR #916)                                                                 |
| **DEF-002** | **P1**   | Disaster Recovery Tooling    | `verify-backup-restore.sh` fails on PostgreSQL 16 backups with `unsupported version (1.15)`   | Script hardcoded `postgres:15-alpine` at line 29, which lacks support for modern archive headers produced by PG 16.                              | **RESOLVED & VERIFIED** (Configured `POSTGRES_IMAGE=postgres:16-alpine`)                        |
| **DEF-003** | **P1**   | Certification Infrastructure | Certification test scripts connected to wrong local port 55432 instead of cert port 55490     | `dotenv.config({ override: true })` in `scripts/certification/*.ts` blindly loaded root `.env`.                                                  | **RESOLVED** (`override: false` and `DOTENV_CONFIG_PATH` enabled)                               |
| **DEF-004** | **P2**   | Event Ingestion              | High-throughput ingestion (1,000+ RPS)                                                        | Separate architectural stream; deferred by steering committee.                                                                                   | **DEFERRED (Post-2.1 Roadmap)**                                                                 |
| **DEF-005** | **P2**   | Runbook Engine               | Unattended write remediation without human approval                                           | Unattended autonomous writes restricted by security design.                                                                                      | **DOCUMENTED BOUNDARY (Approval required)**                                                     |
| **DEF-006** | **P2**   | Mobile PWA / WebKit          | WebKit Mobile viewport emulation exceeded 15s hydration timeout on 5 nested mobile sub-routes | Cold Next.js route bundle hydration and mobile login redirection (`/m/login`).                                                                   | **RESOLVED & VERIFIED** (Targeted `/m/login` selectors; all 49 WebKit routes passed 100%)       |
| **DEF-007** | **P2**   | UI / Status Pages Admin      | Immediate client-side redirect on `/settings/status-pages` aborted browser navigation wait    | Page immediately redirects to default status page editor (`/settings/status-pages/[id]`), causing `net::ERR_ABORTED` in Chromium/WebKit hooks.   | **RESOLVED & VERIFIED** (Catch-and-retry handles client-side redirection cleanly)               |
| **DEF-008** | **P0**   | Operational Chain Harness    | Continuous E2E script bypassed application logic with direct Prisma database writes           | Early test harness directly wrote to Prisma `incident.update`, `runbookExecution.create`, and `auditLog.create` instead of driving through APIs. | **RESOLVED & VERIFIED** (100% application-driven via REST API v2 endpoints; 0 DB shortcuts)     |
| **DEF-009** | **P0**   | Browser Test Harness         | Browser script printed failures but did not exit nonzero, allowing broken routes to slip by   | Test runner lacked `process.exit(1)` on failed routes, lacked DOM mounted content verification, and lacked rate limit safety.                    | **RESOLVED & VERIFIED** (Nonzero exit code, DOM mounting check, disposable guard, 147/147 PASS) |
| **DEF-010** | **P0**   | Upgrade Verification Harness | Upgrade script checked migration count and only 3 entity counts for equality                  | Missing code-level assertions for remaining 7 tables, referential integrity (orphaned rows), and encrypted configuration.                        | **RESOLVED & VERIFIED** (All 10 entity families asserted, 0 orphans, session verified)          |
| **DEF-011** | **P0**   | Recovery Drill Harness       | Restore script manually inserted and updated incident records through raw SQL                 | Early script used SQL INSERT/UPDATE instead of booting declared worker and testing real application HTTP APIs.                                   | **RESOLVED & VERIFIED** (Web + Worker booted, HTTP API create & acknowledge verified in DB)     |
