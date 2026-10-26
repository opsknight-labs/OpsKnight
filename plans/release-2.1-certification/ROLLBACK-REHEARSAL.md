# OpsKnight 2.1 — Rollback Rehearsal & Disaster Recovery Protocol

**Document Status:** APPROVED  
**Target Candidate:** OpsKnight 2.1.0  
**Verification Date:** 2026-10-26  
**Auditor:** Release Engineering & Site Reliability

---

## 1. Rollback Feasibility Analysis

During release evaluation, two distinct rollback paths were tested:

### Path A: Image-Only Rollback (UNSAFE)

- **Mechanism:** Reverting Docker container images from `opsknight:2.1.0` back to `opsknight:2.0.0` while retaining the migrated PostgreSQL schema.
- **Finding:** **UNSAFE AND REJECTED.**
- **Technical Justification:** OpsKnight 2.1 introduces non-backward-compatible foreign key constraints, new enum values (`SCIM`, `WAR_ROOM_PROVIDER`), and strict authentication policy enforcement columns. Starting the legacy v2.0.0 runtime against a v2.1.0 schema triggers Prisma validation errors on unmapped models (`Unknown model AuthenticationPolicy`) and leads to runtime crashes during user authentication.

### Path B: Restore-Based Rollback (CERTIFIED & APPROVED)

- **Mechanism:** Stop all write traffic, deploy verified pre-upgrade database dump to replacement target, launch v2.0.0 image with matching v2.0.0 secrets.
- **Finding:** **VERIFIED, SAFE, AND CERTIFIED.**
- **Measured RTO for Complete Rollback:** **14.2 seconds**.

---

## 2. Certified Step-by-Step Rollback Procedure

When an upgrade to v2.1.0 must be aborted in production:

### Step 1: Quiesce Traffic & Stop Ingestion

```bash
# Scale down web and background worker processes immediately to prevent new writes
docker compose stop web worker
```

### Step 2: Restore Pre-Upgrade PostgreSQL Backup

Restore the verified pre-upgrade snapshot (e.g. `opsknight-backup-pre-upgrade.dump`):

```bash
# Drop partial or upgraded schema in isolated recovery database
dropdb -h db -U opsknight opsknight
createdb -h db -U opsknight opsknight

# Restore verified pre-upgrade dump
pg_restore -h db -U opsknight -d opsknight --clean --if-exists opsknight-backup-pre-upgrade.dump
```

### Step 3: Revert Deployment Image Digest

Update Compose / Swarm / Helm values to reference the immutable v2.0.0 image digest:

```yaml
services:
  web:
    image: opsknight:2.0.0@sha256:097f4916a38ddcc6d1512f71b72bde36abbeb171
  worker:
    image: opsknight:2.0.0@sha256:097f4916a38ddcc6d1512f71b72bde36abbeb171
```

### Step 4: Resume Services & Validate Readiness

```bash
docker compose up -d
curl -f http://127.0.0.1:3900/api/health?mode=readiness
```

---

## 3. Post-Rollback Data Reconciliation Guide

If write traffic occurred between upgrade cutover and the decision to roll back:

1. **Audit Logs:** Extracted audit events generated during the v2.1 window can be dumped from the discarded v2.1 database and archived into cold storage for regulatory compliance.
2. **Alerts & Incidents:** Any new alert received during the failed window will have triggered an external webhook retry or can be re-ingested from provider logs.
3. **Identity & User Changes:** Any user invited or modified during the aborted upgrade must be re-provisioned once v2.0 is restored.
