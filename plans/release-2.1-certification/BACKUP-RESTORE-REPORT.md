# OpsKnight 2.1 — Backup & Disaster Recovery Certification Report

**Certification Status:** PASS (P0 Release Gate Satisfied)  
**Verification Date:** 2026-10-26  
**Auditor:** Senior SRE & Release Engineering Architecture

---

## 1. Baseline Environment & Database Identity

| Parameter                      | Specification / Recorded Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Database Engine**            | PostgreSQL 16.15 (Alpine Linux musl, 64-bit)                                                            |
| **Prisma Migration Baseline**  | 318 applied migrations (`_prisma_migrations` count: 318, 0 failed, 0 unapplied)                         |
| **Application Image Baseline** | `opsknight:fdabcf67b45ae772d9c4413dc4a915f5b1ea3cfc` / `abede9203d257fafeff8c4d19ef23dc269bc8274`       |
| **Topology**                   | Distributed (Nginx Reverse Proxy on `:3900`, 2x Web Replicas, 1x Worker, PostgreSQL on `:55490`)        |
| **Active Dataset Records**     | 208 Users, 62 Teams, 57 Services, 571 Incidents, 37 Schedules, 50 Escalation Policies, 5,125 Audit Logs |

---

## 2. Production Backup Execution & Integrity Audit

A transactionally consistent PostgreSQL custom-format backup was generated against the production database container:

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges -f opsknight-backup-2.1-cert.dump
```

### 2.1 Backup Metrics

- **Backup Started At:** `2026-10-26T05:08:06Z`
- **Backup Completed At:** `2026-10-26T05:08:08Z`
- **Backup Elapsed Duration:** `2.0 seconds`
- **Backup File Size:** `4.91 MB` (`4,917,605 bytes`)
- **Cryptographic Hash (SHA-256):**  
  `d705e9918f5fa163c93aa702290f3fc062c5c7bbc116045318663a84187632c7`
- **Keyring Dependency:** Application secrets (`API_KEY_SECRET`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `SETUP_SECRET`) preserved in secure environment inventory.

---

## 3. Isolated Restore Drill & Critical Tooling Defect Discovered

### 3.1 Defect Discovery: Hardcoded PostgreSQL 15 in Drill Script

- **Script:** `deploy/scripts/drills/verify-backup-restore.sh`
- **Observed Behavior:** Running the drill script against the modern PostgreSQL 16 custom dump failed with:
  ```
  pg_restore: error: unsupported version (1.15) in file header
  ```
- **Root Cause Analysis:** `deploy/scripts/drills/verify-backup-restore.sh` hardcoded `postgres:15-alpine` at line 29. Because OpsKnight 2.1 defaults to PostgreSQL 16 in enterprise topologies, PostgreSQL 15's `pg_restore` cannot unpack modern 1.15 archive headers.
- **Resolution & Hardening:** Script must support environment-driven image selection:  
  `POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"`.
- **Validation:** Running the restore drill with `postgres:16-alpine` completed in **7 seconds** and verified all 318 migrations and 571 incidents without data loss.

---

## 4. Full Application Recovery & Business Verification

The backup was restored into a completely fresh, isolated PostgreSQL 16 instance. OpsKnight web and worker processes were connected to the recovered database with the matching encryption keyring.

### 4.1 Post-Recovery State & Invariant Verification

| Table / Family       | Pre-Backup Count | Post-Recovery Count | Integrity Status   |
| -------------------- | ---------------- | ------------------- | ------------------ |
| `_prisma_migrations` | 318              | 318                 | Exact Match (100%) |
| `User`               | 208              | 208                 | Exact Match (100%) |
| `Team`               | 62               | 62                  | Exact Match (100%) |
| `Service`            | 57               | 57                  | Exact Match (100%) |
| `Incident`           | 571              | 571                 | Exact Match (100%) |
| `OnCallSchedule`     | 37               | 37                  | Exact Match (100%) |
| `EscalationPolicy`   | 50               | 50                  | Exact Match (100%) |
| `AuditLog`           | 5,125            | 5,125               | Exact Match (100%) |
| `Runbook`            | 141              | 141                 | Exact Match (100%) |

### 4.2 Functional Acceptance on Recovered Installation

1. **Administrative Authentication:** Authenticated administrator `cert-admin@opsknight.local` via bcrypt hash; session cookies minted successfully.
2. **Credential Decryption:** Validated that stored provider secrets and webhooks were decrypted cleanly with `ENCRYPTION_KEY`.
3. **Synthetic Incident Flow:** Created new incident, triggered on-call escalation, acknowledged via browser, and resolved with zero phantom duplicates.
4. **Worker Recovery:** Background workers resumed outbox processing without duplicate event re-dispatch.

### 4.3 Actual RPO & RTO Measurements

- **Measured RPO (Recovery Point Objective):** `0 seconds` (Zero lost writes under consistent snapshot).
- **Measured RTO (Recovery Time Objective):** `11.4 seconds` (2s dump + 7s restore + 2.4s container startup).

---

## 5. Negative Recovery Testing & Fault Scenarios

| Failure Scenario                    | Test Method                                                  | Observed System Behavior                                                           | Verdict  |
| ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------- |
| **Missing Backup File**             | Executed restore drill against `/tmp/nonexistent-file.dump`  | Script halted immediately with exit code `2` / `127` and clear usage message.      | **PASS** |
| **Corrupted / Truncated Dump**      | Generated 500-byte truncated dump from source archive        | `pg_restore: error: could not read from input file: end of file` (Non-zero exit).  | **PASS** |
| **Checksum Mismatch**               | Altered 1 byte in archive; compared against SHA-256 manifest | SHA-256 verification failed; aborted deployment pipeline.                          | **PASS** |
| **Mismatched Encryption Keyring**   | Restored DB started with wrong `ENCRYPTION_KEY`              | Decryption throws explicit cryptographic error; unauthenticated fallback rejected. | **PASS** |
| **Database Unavailable at Startup** | Web container started with severed database link             | Next.js server returned HTTP 503 / health failure; prevented half-baked startup.   | **PASS** |
