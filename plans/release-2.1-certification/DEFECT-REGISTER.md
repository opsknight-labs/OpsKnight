# OpsKnight 2.1 — Release Defect & Vulnerability Register

**Audit Date:** 2026-10-26  
**Auditor:** QA Architecture, SRE & Release Engineering

---

## 1. Defect Severity Definitions

- **P0 (Release Blocker):** Data loss, corruption, broken core operational path, unrecoverable migration, or critical security bypass.
- **P1 (Operational Defect):** Broken secondary workflows, recovery script incompatibilities, or misleading operational status.
- **P2 (Non-Blocking / Scope Limitation):** Cosmetic defects or documented feature scope deferrals.

---

## 2. Defect Register & Resolution Audit

| Defect ID   | Severity | Component                    | Summary & Impact                                                                            | Root Cause                                                                                                                                   | Resolution Status                                                   |
| ----------- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **DEF-001** | **P0**   | Runbooks / E2E Suite         | Detached-rule browser tests failed across Chromium, Firefox, WebKit in CI                   | PR #904 compacted card UI copy to `"Rule detached · Archived history"` while `tests/e2e/runbooks-ui.spec.ts` asserted legacy verbose string. | **RESOLVED & MERGED** (PR #916)                                     |
| **DEF-002** | **P1**   | Disaster Recovery Tooling    | `verify-backup-restore.sh` fails on PostgreSQL 16 backups with `unsupported version (1.15)` | Script hardcoded `postgres:15-alpine` at line 29, which lacks support for modern archive headers produced by PG 16.                          | **DOCUMENTED & MITIGATED** (Configurable `POSTGRES_IMAGE` verified) |
| **DEF-003** | **P1**   | Certification Infrastructure | Certification test scripts connected to wrong local port 55432 instead of cert port 55490   | `dotenv.config({ override: true })` in `scripts/certification/*.ts` blindly loaded root `.env`.                                              | **RESOLVED** (`DOTENV_CONFIG_PATH` support enabled)                 |
| **DEF-004** | **P2**   | Event Ingestion              | High-throughput ingestion (1,000+ RPS)                                                      | Separate architectural stream; deferred by steering committee.                                                                               | **DEFERRED (Post-2.1 Roadmap)**                                     |
| **DEF-005** | **P2**   | Runbook Engine               | Unattended write remediation without human approval                                         | Unattended autonomous writes restricted by security design.                                                                                  | **DOCUMENTED BOUNDARY (Approval required)**                         |
