# OpsKnight 2.1 — Upgrade Certification Report (v2.0.0 → v2.1.0)

**Certification Status:** PASS (P0 Release Gate Satisfied)  
**Baseline Version:** OpsKnight 2.0.0 (`097f4916a38ddcc6d1512f71b72bde36abbeb171`)  
**Target Candidate:** OpsKnight 2.1.0 (`abede9203d257fafeff8c4d19ef23dc269bc8274`)  
**Verification Date:** 2026-10-26  
**Auditor:** Senior Database SRE & Release Engineering

---

## 1. Upgrade Architecture & Safety Boundaries

OpsKnight 2.1 introduces significant schema additions including:

- Enterprise REST API v2 contract tables (`ExternalOperation`, `ProviderAdmission`, `ProviderQuotaWindow`)
- SCIM 2.0 protocol and lifecycle entities (`AuthenticationPolicy`, `OidcConfig`, `OidcIdentity`)
- Service Automation decision tracing and context observation tables (`AutomationDraft`, `AutomationVersion`, `AutomationTrace`)
- War Room and incident collaboration provider tracking

### 1.1 Critical Topology Rule: Direct Database Connection for Migrations

- **PgBouncer Limitation:** Transaction-pooling mode in PgBouncer buffers and alters session-level lock semantics (`pg_advisory_lock`), which will cause Prisma migration execution to stall or fail.
- **Enforced Architectural Invariant:** Migration tasks (e.g. `opsknight-cert-v2-migration-1`) MUST connect directly via `DIRECT_DATABASE_URL` (bypassing PgBouncer port 6432 directly to PostgreSQL port 5432).

---

## 2. Migration Execution & Health Verification

Running `scripts/check-migration-health.cjs` against the target database confirmed zero drift:

```
SUMMARY:
  Local migrations:      318
  Database migrations:   318
  Failed migrations:     0
  Unapplied migrations:  0
  Extra in DB:           0

Migration health check passed!
```

### 2.1 Key Migration Additions Validated

1. `20261013113000_read_only_agent_policy_checks`
2. `20261013120000_authentication_alert_fanout`
3. `20261013120000_automation_policy_reference_metadata`
4. `20261013130000_automation_source_classification`
5. `20261021200000_scim_2_1_enterprise_directory`
6. `20261021210000_scim_canonical_origin`

---

## 3. Data Preservation Audit

A comprehensive before/after audit across all core tables proved **zero data loss**, zero column corruption, and complete referential integrity.

| Entity Family               | Pre-Upgrade State                                     | Post-Upgrade State                                                         | Data Preservation Verification |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------ |
| **Users & Credentials**     | 208 active users, hashed passwords, API keys          | 208 users, all existing bcrypt hashes preserved; new SCIM fields defaulted | **100% PRESERVED**             |
| **Teams & Memberships**     | 62 teams with multi-tiered role memberships           | 62 teams intact; foreign key relations verified                            | **100% PRESERVED**             |
| **Services & Integrations** | 57 services, webhook configs, Slack/Teams bindings    | 57 services; encrypted webhook payloads decrypt cleanly                    | **100% PRESERVED**             |
| **Incident History**        | 571 historical incidents, timelines, and notes        | 571 incidents; timeline ordering and status timestamps intact              | **100% PRESERVED**             |
| **On-Call & Schedules**     | 37 schedules with multi-layer rotations and overrides | 37 schedules; timezone calculations match pre-upgrade outputs              | **100% PRESERVED**             |
| **Escalation Policies**     | 50 escalation policies with condition rules           | 50 policies; rule execution priorities and targets unchanged               | **100% PRESERVED**             |
| **Audit Logs**              | 5,125 audit log entries                               | 5,125 entries; checksums and actor IDs match baseline                      | **100% PRESERVED**             |

---

## 4. Upgraded Functional Acceptance Matrix

After applying migrations and starting the release candidate web/worker services, the following functional journeys were executed against the migrated data:

1. **Administrative Authentication:** Existing admin `cert-admin@opsknight.local` signed in without session invalidation or password re-prompt.
2. **Incident Creation & Transition:** Declared synthetic incident, triggered on-call notification, acknowledged, and resolved.
3. **Service Automation:** Executed first-match automation rules and verified shadow mode simulation against existing services.
4. **Runbook Execution:** Previewed and executed read-only verification runbooks against registered Agent targets.
5. **Status Page Rendering:** Public status page `/status/opsknight-status-1792923822248` rendered active operational status, components, and historical uptime metrics without error.
