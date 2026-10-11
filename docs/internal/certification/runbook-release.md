# Runbook release certification

This checklist covers the implementation in PR #859. Passing local tests does
not certify a deployed fleet or physical mobile devices. Keep that distinction
in release notes and record the commit, environment, timestamps, and evidence
for each deployment run.

## Automated gates

Run TypeScript without a cached incremental result and lint every modified
TypeScript file with zero warnings. Run the shared authoring, builder, condition,
policy, signature, output, and runtime tests:

```sh
npx tsc --noEmit --incremental false
npx vitest run --no-file-parallelism --maxWorkers=1 tests/lib/runbooks tests/components/RunbookBuilder.test.tsx tests/integration/runbook-agent-runtime.test.ts tests/lib/deployment-config-unit.test.ts
node --test tests/ci/runbook-change-gates.test.cjs
npm run docs:lint
```

Use a dedicated disposable PostgreSQL database for these tests. The safety suite
truncates tables between tests; never point it at a development or production
database containing useful data. Run database and browser suites sequentially.

```sh
VITEST_USE_REAL_DB=1 npx vitest run --no-file-parallelism --maxWorkers=1 tests/integration/runbook-execution-safety.test.ts tests/integration/runbook-lifecycle-database.test.ts
npm run build
PLAYWRIGHT_PRODUCTION_SERVER=true npx playwright test --config playwright.runbooks.config.ts
```

Set DATABASE_URL and DIRECT_URL to the isolated database after applying migrations.
The browser harness requires database name `runbook_ui_test`. CI provides isolated
PostgreSQL services and installs Chromium, Firefox, and WebKit. Browser artifacts
include failure screenshots, traces, responsive screenshots, and large-workflow
light/dark screenshots. WebKit is an automated engine check, not physical Safari
certification. The 720px CSS viewport approximates 200% zoom on a 1440px desktop;
actual browser zoom and screen-reader checks still require manual review.
The UI harness runs the application in web-only mode and seeds planner/Agent
boundaries explicitly. It exercises real preview, approval, and cancellation
actions without claiming end-to-end execution on a host; separate runtime and
deployment gates cover that boundary.

## Failure contracts and evidence

- Agent/runtime crash: `runbook-agent-runtime.test.ts` crashes during artifact
  upload and restarts with the persisted spool; one successful result is delivered.
  Renewal loss self-fences an in-flight write.
- Uncertain mutation: `runbook-execution-safety.test.ts` checks write timeouts,
  nonzero exits, cancellation acknowledgement loss, and deadline expiry. UNKNOWN
  outcomes must remain visible without automatic unsafe retries.
- Worker concurrency/restart: database tests check duplicate dispatch prevention,
  pending-attempt claim fences, durable WAIT cancellation, and replay of spooled
  results produced within the lease. Real process restarts remain a deployment gate.
- Database failure: lifecycle tests verify rollback on deletion rejection,
  invalid-default publication, and publication/archive/binding races. Test actual
  connectivity interruption separately in the deployment environment.
- Approval versus cancellation: simultaneous completion and approval races verify
  terminal parent invariants and rollback of losing transitions.
- Target loss: source-pool removal, Agent revocation, stale/ambiguous placement,
  and pool concurrency checks preserve target authority. Preview reports current
  Agent availability/capability; dispatch revalidates live authority.
- Deadline expiry: existing claim/start/result fences and local HTTP/WAIT tests
  distinguish completed reads from potentially completed writes.
- Secret access: claiming tests check required grants, confidential transport,
  scoped input delivery, and revocation. Preview checks grant metadata without
  retrieving plaintext; local policy and transport remain dispatch checks.

## Deployment certification to record before release

Run the same representative read-only and approved-write journey on integrated
Compose, split application/worker, and Kubernetes with restricted namespaced RBAC.
Use explicitly authorized disposable targets and credentials. Record:

1. Image/commit, applied migrations, signing pins, worker count, Agent identities,
   pool semantics, effective capabilities, and local policy hash.
2. Preview checksum, resolved non-secret targets, approved plan digest, execution
   correlation ID, attempt claims/start/completion, bounded output, and verification.
3. Agent kill/restart before and after mutation start; application and worker
   restart during WAIT and approval; interrupted database connectivity. Confirm
   the failure contracts above and reconcile the actual target before another write.
4. Two workers and multiple Agents contending for the same workflow. Confirm one
   claim per attempt and preserved source-pool membership authority.
5. Restricted egress, denied RBAC, missing runtime access, revoked secret grants,
   and approval arriving during cancellation. Confirm actionable failure states
   without plaintext credentials in events, artifacts, or logs.

Manifest/unit checks and native-Agent CI installation/rollback tests support these
checks, but do not replace a representative deployed run. This checklist does not
claim that those deployment environments were executed locally.

## Manual accessibility and device gate

- Physical iOS Safari and Android Chrome: create, reorder, rename, validate, save,
  publish, preview, approve, cancel, and troubleshoot a workflow.
- Desktop Chrome, Firefox, Safari: keyboard-only tabs/step navigation, focus visibility,
  accessible names, native unsaved-change prompts, and screen-reader announcements.
- Actual 200% zoom, long wrapped labels, light/dark themes, 320/375/390/430/768/1024/1440px,
  and maximum-depth nested checks. Inspect target sizes and overflow in the focused
  mobile editor as well as the step list.
- Large workflows: record typing latency and validation response at 1/10/25/50 steps,
  30 inputs and near 256 KiB. Database query/load observations require a deployed
  workload; unit timing bounds alone do not establish fleet performance.

Attach dated evidence and reviewer identity before marking these manual gates passed.
