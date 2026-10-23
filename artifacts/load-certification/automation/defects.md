# OpsKnight Service Automation — Production Defects & Remediation Catalog

**Date:** October 21, 2026  
**Baseline:** `8979da9e2233f5dfac2b484b37ebe409f0f9083b` (merged PR #899)  
**Branch:** `cert/service-automation-ga-certification`  
**Certification Status:** ALL DEFECTS VERIFIED & CLOSED

---

## 1. Functional Defect Verification Matrix (PR #898: BUG-01 through BUG-12)

| Defect ID | Severity | Area | Root Cause | Implementation Fix | Verification Method & Evidence | Status |
|---|---|---|---|---|---|---|
| **BUG-01** | High | Context Discovery | Raw dotted JSON paths (`payload.custom_details.repository.name`) surfaced as suggested labels instead of operator-friendly names. | Derives hierarchical, human-readable labels (`Repository Name`) in `src/lib/automation/context-discovery.ts`. | Visual inspection of Context suggestions table. Label formatted properly as `Repository Name`. | **VERIFIED** |
| **BUG-02** | High | Context Management | Collision when adding fields with identical names overwrote existing keys without warning. | Added `deriveUniqueFieldKey` to append incrementing numeric suffix (e.g., `replica_count_2`). | Created duplicate `replica_count`; auto-derived `replica_count_2` with no collision. | **VERIFIED** |
| **BUG-03** | Medium | Context Wizard | Selecting an observed field failed to sync Integration identity, provider source, or field type. | Synchronized `integrationId`, `sourceType`, and `type` inside `selectObservedField` in `context.tsx`. | Selected `[0].replica_count`; automatically synchronized Integration (`EVENTS_API`), Path (`[0].replica_count`), Type (`NUMBER`), Source (`PROVIDER`). | **VERIFIED** |
| **BUG-04** | High | AST Discovery | Root array discovery in payloads failed to extract bracket paths. | Added bracket path parser support (`[0].cluster_name`, `[0].replica_count`) in discovery AST. | Injected `[{"cluster_name": "rds-aurora", "replica_count": 3}]`; discovery correctly surfaced bracketed paths. | **VERIFIED** |
| **BUG-05** | Low | UI Dropdown | Dropdowns displayed unformatted raw path strings without integration badges. | Formatted dotted path labels with integration badges in dropdown components. | Dropdown shows `[0].replica_count · NUMBER · EVENTS_API · PROVIDER`. | **VERIFIED** |
| **BUG-06** | High | Test Simulation | Selecting a recent alert in Test workspace wiped or misattributed the original provider identity. | Cleanly resolved integration identity from recent alert event record in `test.tsx`. | Selected GitHub alert `cmvgoalc41ubs7m59tf5c3c0h`; integration cleanly attributed to `GitHub Actions`. | **VERIFIED** |
| **BUG-07** | Medium | Test Simulation | Test workspace blurred distinction between raw provider replay and normalized-only replay. | Added explicit UI disclaimer and separate raw input textarea for advanced simulation. | Verified UI note: *"Recent alerts replay the normalized OpsKnight event only; full raw provider payloads are not retained for replay to prevent sensitive credential leakage."* Full provider test executed in 3.32ms. | **VERIFIED** |
| **BUG-08** | Critical | Rule Evaluator | Negative condition operators (`NE`, `NOT_IN`) evaluated to true on missing/unmapped fields. | Fixed condition evaluation in `rule-engine.ts` so missing/unmapped values yield `UNKNOWN` (failing closed). | Verified evaluation trace: missing field `repository_url` under `NE` condition fails safe and does not trigger rule. | **VERIFIED** |
| **BUG-09** | Medium | Rule Evaluator | Case-sensitive ENUM matching caused valid alerts with differing casing to fail. | Added canonical case-insensitive normalization for ENUM values. | Alert containing `"production"` matches rule expecting `"Production"`. | **VERIFIED** |
| **BUG-10** | Medium | Schema Linting | Fields mapped solely for runbook display generated false positive `UNUSED_FIELD` lint warnings. | Added `displayOnly` boolean flag in `schema.ts` to suppress unused field warnings. | Toggled `displayOnly` on context field `aws_resource_name`; `UNUSED_FIELD` warning immediately suppressed. | **VERIFIED** |
| **BUG-11** | High | Context Mapping | CloudWatch events send `AWSAccountId` instead of `awsAccountId`, resulting in unmapped account numbers. | Added canonical dual-alias mapping in CloudWatch context definitions. | Selected CloudWatch alert `cmvguxx8624ur7m59v7e4r9f2`; provider payload containing `"AWSAccountId": "123456789012"` extracted cleanly into canonical field `aws_account_id`. | **VERIFIED** |
| **BUG-12** | Medium | Context Navigation | `AlertDialogAction` in `RemoveFieldDialog` lacked clean programmatic navigation to the affected rule. | Added router navigation and accordion expansion in `RemoveFieldDialog`. | Clicked "View affected rules" on `Repository Name`; dialog dismissed cleanly and opened Rules tab with rule `R03` auto-expanded. | **VERIFIED** |

---

## 2. Capacity & Scale Defect Remediation (PR #899 Hardening)

### DEF-CAP-01: Full Diagnostic Trace Advisory Lock Saturation under SHADOW Mode
- **Symptom:** Sustained 20 RPS load in `shadow-small` degraded ingestion latency (p95 > 4.3s) and caused 55 dropped iterations due to queue backlog.
- **Root Cause:** In `src/lib/automation/runtime.ts`, `diagnosticLevel: 'FULL'` was triggered whenever `runtime.shadowDifferent` was true. Because test shadow rules deliberately differed from default routing, 100% of incoming alerts generated a ~5KB FULL JSON trace instead of the intended 1-in-20 (5%) sample. Concurrently, 546 `AUTOMATION_OBSERVE` background jobs contended for the advisory transaction lock in `persistObservationBatch`.
- **Remediation:** Removed `runtime.shadowDifferent` from the FULL diagnostic trace trigger, restoring 1-in-20 sampling for diagnostic traces while preserving the `shadowDifferent` boolean flag in COMPACT traces for full UI comparison fidelity.
- **Verification:** Post-fix `shadow-small` ran with **p95 = 85ms** (0.32× baseline), 0 dropped iterations, and 0 queue backlogs.

### DEF-CAP-02: Tag Table Index Lock Contention under High-Complexity Rule Evaluation (LIVE-worst)
- **Symptom:** In `live-worst` with 8 `ADD_TAG` actions evaluated across 20 concurrent alerts/second, PostgreSQL suffered index locking and transaction serialization on `Tag(name)`.
- **Root Cause:** `persistAutomation` executed `tx.tag.createMany` and `tx.tag.findMany` on the same 8 tag names on every single alert transaction.
- **Remediation:** Introduced in-memory `tagIdCache` in `src/lib/automation/runtime.ts`. Once tag IDs are cached after initial creation, subsequent transactions bypass `Tag` lookups entirely and write directly to `tx.incidentTag.createMany`.
- **Verification:** Zero deadlocks (`deadlocksDelta: 0`) and zero transaction timeouts across sustained 20-RPS `live-worst` evaluation.

### DEF-CAP-03: Host Workload Interference from Background Kind Cluster
- **Symptom:** Docker container build times exceeded 12 minutes and CPU was starved for web worker ingestion.
- **Root Cause:** Unrelated Kind Kubernetes cluster `opsknight-cluster-control-plane` left running from an earlier test was consuming 466% CPU.
- **Remediation:** Stopped unrelated Kind container and enforced isolated CPU pinning (`cpuset`) for the 8-container split Compose stack.
- **Verification:** Quiescent host baseline established; Docker build completed in 296s; web worker p95 ingestion latency stabilized at 100-300ms.

### DEF-CAP-04: Interactive Prisma Transaction Serialization Latency in Automation Persistence
- **Symptom:** Under sustained concurrent ingestion, separate Prisma interactive transaction calls for `IncidentAutomationDecision`, `AutomationTrace`, and `BackgroundJob` incurred multiple serialized round-trips over the transaction connection, pushing latency ratios above 1.25x.
- **Root Cause:** Prisma interactive transactions serialize model `.create()` operations sequentially over the single connection, adding IPC serialization and multiple PostgreSQL round-trips under concurrent load.
- **Remediation:** Implemented a single-roundtrip PostgreSQL CTE query (`WITH ins_decision AS (INSERT INTO ...) ins_trace AS (INSERT INTO ...) INSERT INTO BackgroundJob ...`) in `src/lib/automation/runtime.ts` when `$executeRaw` is available, collapsing multiple persistence writes into a single ~2ms PostgreSQL round trip, while preserving the standard Prisma `.create` fallback for unit test mocks.
- **Verification:** All 5 profiles passed the $\le 1.25\times$ capacity comparison gate (`service-disabled` 0.928×, `shadow-small` 1.159×, `live-small` 0.915×, `live-medium` 0.933×, `live-worst` 0.963×). 0 deadlocks, 0 dropped iterations, and 100% incident consistency (601/601 acknowledged events persisted).
