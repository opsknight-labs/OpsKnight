# OpsKnight 2.1 — Rollback Rehearsal & Disaster Recovery Protocol

**Document Status:** APPROVED  
**Target Candidate:** OpsKnight 2.1.0 (`ed0c46289dd9b73d0c22f3f77e800a496b2f0be3`)  
**Baseline Version:** Published OpsKnight 2.0.0 (`ghcr.io/opsknight-labs/opsknight:2.0.0`, Image Digest: `sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62`)  
**Verification Date:** 2026-10-26  
**Auditor:** Release Engineering & Site Reliability  
**Reproducible Script:** `scripts/certification/drill-rollback-rehearsal.sh`

---

## 1. Rollback Feasibility Analysis & Invariants

During release certification, both image-only and restore-based rollback paths were evaluated:

### Path A: Image-Only Rollback (UNSAFE / BLOCKED)

- **Mechanism:** Reverting Docker container images from `opsknight:2.1.0` back to `opsknight:2.0.0` while leaving the migrated PostgreSQL schema intact.
- **Finding:** **BLOCKED & UNSAFE.**
- **Technical Justification:** OpsKnight 2.1 introduces 141 new schema migrations (+58 tables, new enum values for SCIM and War Room providers, strict `AuthenticationPolicy` foreign keys). Starting the legacy v2.0.0 Prisma runtime against a v2.1.0 schema triggers Prisma schema validation mismatch and causes runtime exceptions during authentication and background processing.
- **Verdict:** Image-only rollback must never be executed across major/minor schema boundaries.

### Path B: Restore-Based Rollback (CERTIFIED & VERIFIED)

- **Mechanism:** Stop write traffic, preserve the failed v2.1 database intact for forensic examination, restore verified pre-upgrade backup into a clean database target, and launch the v2.0.0 application container with matching secrets.
- **Finding:** **VERIFIED, SAFE, AND CERTIFIED.**
- **Measured Metrics:**
  - Backup restore duration: **17.0 seconds**
  - Application boot to healthy HTTP 200: **20.0 seconds**
  - Total Rollback RTO: **37.0 seconds**

---

## 2. Certified Step-by-Step Rollback Procedure

When an upgrade to v2.1.0 must be rolled back:

### Step 1: Quiesce Traffic & Stop Ingestion

```bash
# Immediately stop web and background worker containers to halt incoming writes
docker compose stop web worker
```

### Step 2: Preserve Failed Database & Restore Pre-Upgrade Backup

> [!CAUTION]
> **Never drop the only existing database.** Retain the upgraded database container or rename it (e.g., `ALTER DATABASE opsknight RENAME TO opsknight_failed_upgrade;`) so forensic artifacts, audit trails, and any transactions committed during the upgrade window are preserved.

```bash
# Rename failed database for forensics (never drop without backup)
psql -h db -U opsknight -c "ALTER DATABASE opsknight RENAME TO opsknight_failed_upgrade;"

# Create fresh empty target database
createdb -h db -U opsknight opsknight

# Restore verified pre-upgrade custom-format backup
pg_restore -h db -U opsknight -d opsknight /tmp/opsknight-v2.0.0-baseline.dump
```

### Step 3: Revert Deployment Image to Immutable Baseline Digest

Update Docker Compose or deployment configuration with the exact, immutable v2.0.0 image digest:

```yaml
services:
  web:
    image: ghcr.io/opsknight-labs/opsknight:2.0.0@sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62
  worker:
    image: ghcr.io/opsknight-labs/opsknight:2.0.0@sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62
```

### Step 4: Resume Services & Validate Health

```bash
docker compose up -d web worker
curl -f http://127.0.0.1:3900/api/health?mode=readiness
```

---

## 3. Physical Drill Verification Results

The drill executed via `scripts/certification/drill-rollback-rehearsal.sh` produced the following log output:

```text
[drill-rollback] Step 1: Simulating failed v2.1 state on isolated DB...
[drill-rollback] Step 2: Quiescing writes. Retaining failed DB for forensics...
[drill-rollback] Step 3: Restoring pre-upgrade baseline backup into isolated target...
[drill-rollback] Pre-upgrade DB restored in 17s. Verified: 177 migrations, 121 tables.
[drill-rollback] Step 4: Booting published v2.0.0 container on port 3992...
[drill-rollback] Verifying HTTP 200 on /login... PASSED
[drill-rollback] Testing admin login on rolled back instance... HTTP 302 Found (Session authenticated)
[drill-rollback] Rollback rehearsal PASSED. Total Rollback RTO: 37s.
```

- **Rollback RTO:** 37.0 seconds.
- **Data Loss on Rolled-Back Baseline:** 0 baseline records lost.
- **Forensic Preservation:** Failed upgrade database was preserved untouched.
- **Status:** **PASS**
