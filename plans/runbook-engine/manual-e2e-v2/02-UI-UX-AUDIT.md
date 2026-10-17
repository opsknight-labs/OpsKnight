# Phase 2 — UI/UX Audit & User Journey Verification

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Application:** OpsKnight SaaS (`https://opssentinal.com`)  
**Methodology:** Browser-first interaction via Chrome Remote Debugging (DevTools Protocol) with genuine user inputs, form submissions, and mouse click events.

---

## 1. Scope of UI Audits

The audit verified all administrator, incident responder, and operator journeys across the OpsKnight web console:

| Area                             | Evaluated Features                                                                                                      | Audit Result | Evidence Screenshot                            |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :----------- | :--------------------------------------------- |
| **Runbook Library**              | Filtering (All, Published, Draft, Archived), search, grid/list view toggles, create button.                             | **PASS**     | `screenshots/opssentinal_runbooks_list.png`    |
| **Runbook Detail & Timeline**    | Hero banner, concentric version timeline, tabs (Overview, Workflow, Versions, Usage, Executions), danger zone controls. | **PASS**     | `screenshots/runbook_docker_detail.png`        |
| **Workflow Authoring & Checks**  | Visual builder, step risk classification, draft configuration validation, approval gate indicators.                     | **PASS**     | `screenshots/runbook_auto_docker_workflow.png` |
| **Fleet Agents & Enrollment**    | Fleet table, platform icons, online/offline status, heartbeat intervals, single-use token creation drawer.              | **PASS**     | `screenshots/opssentinal_agents.png`           |
| **Service Ingestion & Webhooks** | Integrations tab, 28 provider catalog, unique endpoint generation, Prometheus Alertmanager configuration.               | **PASS**     | `screenshots/service_integrations_tab.png`     |
| **Automation Rules & Evidence**  | Attached rules list, execution mode badges, rule readiness evaluation, policy validation triggers.                      | **PASS**     | `screenshots/e2e_docker_runbooks_tab.png`      |
| **Interactive Plan Preview**     | Inline step risk expansion, target Agent identity check, authorization confirmation checkbox, plan execution trigger.   | **PASS**     | `screenshots/plan_confirmed.png`               |
| **Approval Gates & Governance**  | Paused state indicator, parameter review, exact plan digest confirmation, submit button dispatch.                       | **PASS**     | `screenshots/journey_f_waiting_approval.png`   |
| **Live Execution View**          | Real-time status updates, attempt timeline, bounded step stdout/stderr preview, post-state evidence artifacts.          | **PASS**     | `screenshots/journey_a_final_succeeded.png`    |
| **Incident SLA Tracking**        | Ack/Resolve response timers, alert context JSON, associated runbooks, resolution state transitions.                     | **PASS**     | `screenshots/journey_a_incident_resolved.png`  |

---

## 2. Key UI/UX Observations & Ergonomics

1. **Safety Controls during Execution Authorization:**
   - When an operator previews a runbook execution from an incident (`RunbookExecutionPreview.tsx`), the interface displays a clear visual breakdown:
     - Published version and immutable checksum.
     - Target Agent identity and readiness status.
     - Explicit risk classification for each step (`READ_ONLY`, `IDEMPOTENT_WRITE`, `NON_IDEMPOTENT`).
     - Whether human approval will be required at runtime.
   - Execution cannot be triggered until the user explicitly checks: _"I reviewed the target and authorize the planned writes."_ This prevents accidental automated executions.

2. **Approval Gate Experience:**
   - For non-idempotent steps (such as Kubernetes rollout restarts), execution automatically pauses with status `Waiting approval`.
   - The UI highlights the exact plan parameters (`action`, `resource`, `namespace`, `target`, `timeout`, and cryptographic plan digest) and provides a dedicated `Approve exact plan` button for authorized responders.

3. **Timezone Uniformity:**
   - Execution timestamps, heartbeat indicators, and incident timelines consistently render with operator-friendly localized timestamps (`GMT+5:30 (Asia/Kolkata)`), preventing ambiguity during coordinated crisis response.
