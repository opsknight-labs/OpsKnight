# OpsKnight Runbook Engine — Enterprise E2E Certification: Bug Register

**Document Version:** 2.1.0-cert2  
**Date:** October 17, 2026  
**Auditor:** Antigravity Advanced Agentic Coding Pair  
**Branch:** `feat/runbook-full-automatic-e2e-certification`  
**Control Plane:** `https://opssentinal.com`

---

## 1. Executive Summary & Defect Tracking

This register details all defects discovered during the end-to-end certification audit, their root causes across UI, Agent runtime, deployment generators, and test suites, the implemented fixes, and the regression tests confirming their permanent resolution.

---

## 2. Certified Defect Register

### Defect BUG-01: Agent Setup Environment Variable Contract Mismatch

- **Severity:** High
- **Category:** Deployment / Agent Runtime
- **Browser-Visible Symptom:** Running the generated Docker command failed with `Missing required enrollment token` despite token being present.
- **Affected Code Paths:** `src/lib/runbooks/agent-setup-commands.ts`, `agent/src/index.ts`
- **Root Cause:** Command generator output `OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE` while `agent/src/index.ts` only read `OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH`.
- **Root-Cause Fix:** Implemented canonical fallback resolution in `agent/src/index.ts`:
  ```ts
  const tokenFile =
    process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE ??
    process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH;
  ```
- **Regression Test:** `tests/lib/runbooks/agent-deployment.test.ts`
- **Fixing Commit:** Commit `3d3cd4d23` / PR #888
- **Status:** `RESOLVED & VERIFIED`

---

### Defect BUG-02: Docker Agent Container Healthcheck Startup Race

- **Severity:** High
- **Category:** Agent Executor / Infrastructure Timing
- **Browser-Visible Symptom:** Automatic recovery of stopped Docker container intermittently failed verification with `CONTAINER_UNHEALTHY`.
- **Affected Code Paths:** `agent/src/executor.ts`
- **Root Cause:** When Docker starts a container, `State.Health.Status` is initially `"starting"` until the interval expires. The verification step executed immediately, treated `"starting"` as a failure, and aborted before the probe ran.
- **Root-Cause Fix:** Added startup polling loop in `executeAttempt` for `action === 'health'`:
  ```ts
  while (
    !containerHealthPassed(result.output) &&
    isContainerStarting(result.output) &&
    Date.now() - startCheckTime < maxWaitMs &&
    !signal.aborted
  ) {
    await new Promise(r => setTimeout(r, 1000));
    const retry = await executeCommand(attempt, policy, signal);
    result.output = retry.output;
  }
  ```
- **Regression Test:** `tests/lib/runbooks/agent-executor.test.ts`
- **Fixing Commit:** Commit `3d3cd4d23`
- **Status:** `RESOLVED & VERIFIED`

---

### Defect BUG-03: Incident Step Timeline Icon and Text Overlap

- **Severity:** Medium
- **Category:** UI Layout & Responsiveness
- **Browser-Visible Symptom:** In the Incident Runbooks tab, the step status circle icon visually overlapped the step title text (e.g. `Restart Kubernetes deployment`).
- **Affected Code Paths:** `src/components/incident/IncidentRunbooks.tsx`
- **Root Cause:** `<li>` used `pl-9` with `absolute left-0` on the icon span. In flexbox parent containers or narrow viewports, the padding collapsed, placing text at x = 0 directly on top of the icon.
- **Root-Cause Fix:** Refactored `<li>` to a flex container (`flex items-start gap-3.5 pb-5`). The icon now lives in a dedicated flex child column (`w-6 shrink-0`), making visual overlap physically impossible across all viewports.
- **Regression Test:** `tests/components/incident-runbook-refresh-timeline.test.tsx`
- **Fixing Commit:** Commit `01f768f37`
- **Status:** `RESOLVED & VERIFIED`

---

### Defect BUG-04: Lack of Live Auto-Refresh for Active Executions

- **Severity:** Medium
- **Category:** UI Responsiveness & UX
- **Browser-Visible Symptom:** When an execution was running or waiting for approval, the Incident page remained static, forcing operators to repeatedly hit manual browser refresh.
- **Affected Code Paths:** `src/components/incident/IncidentRunbooks.tsx`, `src/components/incident/runbooks/IncidentRunbookRefreshButton.tsx`
- **Root Cause:** Next.js server component lacked a client polling hook.
- **Root-Cause Fix:** Created `IncidentRunbookRefreshButton` with 4-second polling (`router.refresh()`) when active executions exist, accompanied by a pulsing live beacon and manual refresh spinner.
- **Regression Test:** `tests/components/incident-runbook-refresh-timeline.test.tsx`
- **Fixing Commit:** Commit `01f768f37`
- **Status:** `RESOLVED & VERIFIED`

---

### Defect BUG-05: Workflow Builder Step Configuration Hidden on Laptops

- **Severity:** High
- **Category:** UI Layout & Builder
- **Browser-Visible Symptom:** On standard laptop viewports (1280x800) with the sidebar open, clicking steps in the Workflow Builder did not show the step editor, making steps look empty or lost.
- **Affected Code Paths:** `src/components/runbooks/RunbookBuilder.tsx`
- **Root Cause:** Split grid breakpoint was hardcoded to `lg:col-span-8` with `hidden lg:block`. Available content width was less than 1024px due to navigation drawer.
- **Root-Cause Fix:** Changed grid split breakpoint from `lg` to `md` (`md:col-span-7`), added `pb-32` bottom padding, and integrated `getStepSummary` badge in step headers.
- **Regression Test:** `tests/components/incident-runbook-refresh-timeline.test.tsx`
- **Fixing Commit:** Commit `01f768f37`
- **Status:** `RESOLVED & VERIFIED`

---

### Defect BUG-06: Raw Stringified JSON in Recovery Evidence Accordion

- **Severity:** Low
- **Category:** UI Display & Usability
- **Browser-Visible Symptom:** The execution recovery evidence displayed raw JSON strings (`{"field":"kubernetesState","before":"{\"ready\":2,\"desired\":2}"}`), creating hollow/empty-looking boxes.
- **Affected Code Paths:** `src/components/incident/IncidentRunbooks.tsx`
- **Root Cause:** Missing formatting parser for evidence change records.
- **Root-Cause Fix:** Implemented `formatEvidenceDifference` converting raw telemetry into human-readable metric diff chips:
  - Pods: `Ready replicas: 2/2 → 0/2 (gen 1 → 2)`
  - Memory: `2189 MB → 2172 MB (of 7.7 GB total)`
  - CPU: `1m load: 2.1 → 1.8 (4 cores)`
- **Regression Test:** `tests/components/incident-runbook-refresh-timeline.test.tsx`
- **Fixing Commit:** Commit `01f768f37`
- **Status:** `RESOLVED & VERIFIED`
