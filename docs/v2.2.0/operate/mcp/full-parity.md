# Full-parity delivery

The full-parity plan supplied against `c95b601c5862e41037df7324d4c20a120afcc319` is the design reference for continuing draft PR #924. Its protocol and release targets are acceptance criteria, not claims about this build. PostgreSQL remains the only required state store; native authorization, domain commands and critical workers remain authoritative.

## Inventory and acceptance

Generate source-labelled evidence outside the repository:

```sh
npm run --silent mcp:coverage > /tmp/opsknight-mcp-coverage.json
npm run --silent mcp:coverage -- --require-full-parity > /tmp/opsknight-mcp-parity.json
```

The first command checks registry coverage, unique IDs, strict review metadata, contract/route fingerprints, native authorization actions and adapter mappings. It fails closed for unknown risk/status values or R2/R3/R4 generic exposure. The second additionally fails when unfinished operations remain. Neither command certifies interoperability, independent parity review or production performance.

The report includes domain, method, risk and disposition totals and operation IDs. `CURATED_TOOL` and `DISCOVERABLE` identify candidates with adapters. `MCP_EQUIVALENT` currently identifies approved native runbook execution with its tools and test evidence. `PENDING_IMPLEMENTATION` identifies missing adapters/workflows. `PENDING_EXCLUSION_REVIEW` identifies current safety denials whose per-operation exclusions still need review. A generic denial is not evidence of completed workflow coverage. No independent exclusions are marked reviewed by this implementation.

For a future reviewed exclusion, record the operation-specific reason, reviewer and safe equivalent where applicable; validate these records before allowing them to satisfy the parity gate. Until then, pending exclusions remain blockers. Every new operation starts blocked until its projection, authorization, cost and failure behavior are reviewed and tested. Never reclassify an operation merely to increase the supported count.

## Delivery sequence

1. Finish the inventory baseline: review each pending operation, define supported client versions and capture critical-workload baselines. The generated report now makes the missing workflows explicit; these baseline gates are not all complete.
2. Certify protocol and OAuth: headers, metadata, standard errors, output schemas, cache hints, pagination, safe CIMD fetching, issuer/resource binding and explicit compatibility decisions. Advertise only features tested against the exact pinned SDK.
3. Close domain workflows through shared native commands. Include postmortem creation/editing, action-item lifecycle, contributor changes and publication; service dependencies; schedules/overrides; automation versioning; notification diagnosis/retry; status-page operations; reports; identity/access administration and audit. Use the generated inventory for the actual operation list.
4. Extend frozen prepare/native independent review/commit to sensitive operation families. Bind target revisions, policy, actor/grant and expiry. Prove stale-authority rejection, concurrent consumption, durable replay and recovery before enabling a family.
5. Implement modern Tasks with per-request capability negotiation, durable grant-bound receipts, status/update/cooperative cancellation and worker recovery. Reuse native execution/leases where possible. Implemented for `runbook_execute_approved` only (see the catalog reference); further task-capable tools need their own durable state and recovery proof.
6. Complete authorized resources, versioned prompts, completions and safe multi-round-trip input. Add separately bounded modern subscription capacity and cross-replica wakeups; streams must never hold database transactions. Optional Apps require a sandbox and ordinary tool/resource fallback. Code Mode stays disabled pending separate certification.
7. Run security/dependency remediation, baseline comparisons for unrelated CI failures, migration/rollback drills and fault injection. Measure 0/10/25/50/100 MCP concurrency while ingestion, paging, delivery and runbooks operate. Record latency, SQL time/count, locks, connection waits and critical backlog; pool separation and query counts alone are insufficient.
8. Package admin policy/retention controls, client guides, support matrix and exact-source/image evidence. Keep the PR draft until all required CI, interoperability, recovery and production gates pass.

## Approval batch process (every batch, no exceptions)

1. Pick a small family from `byNextStep` in the coverage artifact. R2 writes with `required` or `supported` idempotency and a JSON body qualify directly. A `natural` write qualifies only when its route runs the approval guard inside its own transaction. An R3 operation also needs an item-level `impactPreview` of the exact target; scopes it needs for that read go in `additionalScopes`, and it uses `tests/integration/mcp-approval-destructive*.test.ts`. One-time-secret responses never qualify.
2. Read the REST route first: authorization action, `If-Match` source (what revision it fences), `replayAuthGuard`, and the library command it calls. Do not wrap logic; reuse the route handler.
3. In `review.json` set `status: APPROVAL_REQUIRED` and `evidence` to the batch test; add the handler to `MCP_APPROVAL_HANDLERS` (never `MCP_HANDLERS`).
4. Write `tests/integration/mcp-approval-<family>.test.ts` using `describeApprovalScenarios`: per operation a setup, the frozen input, a comparable `effect`, and an `invalidate` that makes the frozen revision stale (omit only when the route has no revision precondition, and then add a specific rejection test).
5. Register the test in `package.json` (`test:mcp:db`), `.github/workflows/mcp-certification.yml` and `scripts/mcp/local-check.cjs`.
6. Run, locally: `tsc`, eslint, `test:mcp`, `test:mcp:db`, `mcp:coverage` (no failures), then push and require the CI `contract-security` job green on that exact SHA. `release-gates` stays red by design until reviewed live evidence exists.
7. Update the counts and the enabled list in `reference/mcp/catalog.md`.

CI notes from certifying this branch: the browser step is sensitive to slow shared runners (`playwright install --with-deps` can hang; re-run the job on the same SHA rather than pushing). The dependency audit is judged against `scripts/mcp/audit-baseline.json`; every entry needs an owner, justification and expiry.

## Current checkpoint

Inventory (from `npm run --silent mcp:coverage`): 320 operations.

- 136 generic candidates: 75 ordinary, plus 61 sensitive reads behind the administrator opt-in.
- 107 approval-gated: 87 R2 and 20 R3.
- 1 native equivalent (approved runbook execution).
- 76 open. The [exclusion review packet](./exclusion-review.md) proposes implementing 1 (`updateStatusPage`) and excluding 75. No exclusion is reviewed: `reviewedExclusions` is 0.
- The parity report keeps `implementationComplete: false` and `certified: false`.

Implemented since the previous checkpoint:

- R2 approval batches for every family with a durable receipt, plus nine receipt-less writes whose routes run the approval guard inside their transaction (including schedule overrides, status-page creation and notification retry, whose domain commands now run the guard first in their own transaction).
- Destructive (R3) approvals with impact preview, reviewer recent sign-in, commit-time re-read, postcondition and natural-delete reconciliation.
- An atomic `COMMITTED` mark and commit audit written in the effect's own transaction.
- Sensitive reads, including 4 reviewed side-effect-free POST reads.
- Resource subscriptions, completions and the Tasks extension for approved runbook execution.

Local evidence on PostgreSQL (not CI, not production):

- `npm run test:mcp` passes 55 tests. `npm run test:mcp:db` passes 902 tests in 28 files; the two child-only harness files are skipped by design.
- `tests/integration/mcp-fault-injection.test.ts` runs a commit in a separate OS process.
  - It kills the whole process group with `SIGKILL` inside the effect transaction and immediately after it commits, and terminates the server-side PostgreSQL backend mid-commit with `pg_terminate_backend`.
  - A retry from a fresh process must then produce exactly one effect and one `COMMITTED` approval.
  - It passed three consecutive runs.
- `scripts/mcp/mixed-load.cjs` runs the ingestion benchmark (synchronous and durable PostgreSQL modes, 200 events) while a separate OS process (`tests/integration/mcp-load-worker.test.ts`) sustains MCP reads at 0, 10, 25, 50 and 100 concurrent principals through the isolated MCP pool. Each principal has its own grant, so per-principal quotas do not hide the load.
  - Every level stayed within the thresholds (p95 at most 2x baseline, throughput at least 0.5x) and reconciled every event.
  - Synchronous p95 ratio peaked at 1.59x; durable throughput was at least 0.78x.
  - MCP throughput stayed flat at about 2.8k requests per window from 10 to 100 principals while MCP latency rose. The MCP admission cap, not ingestion, absorbs the extra load.
  - Evidence is written outside the repository and marked `certified: false`.

Still outstanding:

- Named human review of the 75 proposed exclusions.
- A transactional design for disabling a status page that keeps the withdraw-before-commit privacy guarantee (`updateStatusPage`).
- Certification with real external clients (ChatGPT, Claude, Cursor, VS Code).
- Multi-replica and PostgreSQL failover drills on production-like infrastructure.
- MCP Apps.
- Reviewed final-SHA evidence for `release-gates`.

This branch remains incomplete and the PR stays draft.

## Approval safety gate (blocks enabling further operations)

Do not enable another approval-gated operation until `tests/integration/mcp-approval-crash-safety.test.ts` passes for the exact final SHA and the new operation has family-specific positive and negative tests. The invariants it demonstrates against PostgreSQL:

- A fault-injection sweep fails the commit at every phase boundary (before/inside each transaction and after the domain effect committed), retries, and requires exactly one effect and a `COMMITTED` approval. It runs for a revision-bound `required` operation and for a create operation, and it asserts that the "effect committed, outcome not recorded" window was actually visited. Mutation check: replacing the approval-derived REST idempotency key with a random one produced a duplicate effect and failed the sweep.
- A prepare interrupted at every boundary and retried produces one approval.
- Eight concurrent commits apply one effect and write one commit audit; a sibling grant of the same user cannot commit; racing reviewers (approve/approve, approve/reject) produce exactly one decision and one audit row.
- A claimed approval cannot be resumed after its one-hour execution window; an expired approval never executes on any retry; tampered digest, contract digest or envelope fail closed; stale revisions, demoted or re-versioned reviewers, revoked grants/tokens and writes-disabled policy all prevent the effect.
- A definitive-rejection `FAILED` mark is never written over a durable REST receipt, so a committed effect cannot be reported as failed.

Exactly-once relies on two things:

- the approval's `COMMITTED` mark committing in the same transaction as its effect;
- for receipt-backed operations (`required` or `supported`), the REST command's durable idempotency receipt.

A receipt-less (`natural`) write is gated only when its route runs the approval guard inside that transaction. These are local PostgreSQL results, not CI or production certification. Real process kills and backend termination are exercised locally (see the current checkpoint). PostgreSQL failover and multi-replica execution on production-like infrastructure remain unproven. This branch remains incomplete.

## Generic approval checkpoint (history)

Phase D now has its reusable engine: `McpOperationApproval` (additive migration), the `APPROVAL_REQUIRED` review status (R2 only), `operation_prepare` / `operation_get_approval` / `operation_commit_approved`, and a native review page. The engine is exercised by `tests/integration/mcp-operation-approval.test.ts` for same-reviewer rejection, reviewer demotion or token-version change, requester grant revocation, writes disabled, digest/envelope tampering, expiry, stale revision, wrong grant, concurrent commit and crash recovery. Fifteen operations are enabled across four families (teams and response policies, Service Automation, runbook rules, and the original three). Every batch must use the shared harness `tests/helpers/mcp-approval-scenarios.ts` (positive commit with audit, stale revision, unauthorized reviewer, revoked requester, interruption sweep, generic-dispatch refusal). The original seven were (`setTeamLead`, `setTeamMember`, `assignTeamService`, `updateServiceSupportHours`, `updateServiceSlaPolicy`, `updateServiceClassificationPolicy`, `createStatusPageAnnouncement`); the second batch (teams and response policies) has positive, stale-revision, unauthorized-reviewer, revoked-requester and interruption-sweep tests per operation. The remaining R2 writes must each be enabled only with family-specific tests. R2 reads, R3 destructive operations (which additionally need recent re-authentication and postcondition verification), reviewed exclusions, Tasks, subscriptions and Apps are not part of this checkpoint.

## OAuth checkpoint (history)

CIMD is implemented behind an administrator policy (`cimdEnabled`, exact `cimdAllowedHosts`, `cimdScopes`; additive migration, default off) with an SSRF-resistant pinned fetch and immediate trust-policy revocation (see the catalog reference). Unit tests cover URL canonicalization, address classification, redirect/oversize/DNS-rebinding rejection and document validation; `tests/integration/mcp-client-metadata.test.ts` covers policy, scope ceiling, sticky revocation, identity squatting and grant invalidation. Still open for Phase B: issuer-bound credential validation beyond the existing resource check, scope step-up/incremental consent, a decision on legacy DCR and 2025-era compatibility, and certification against real clients.

## Previous checkpoint

The postmortem read workflow adds contributor and paginated history adapters, a bounded four-source context tool and a scoped resource template. It preserves private-parent authorization, fresh revocation, redaction, native quotas and the request budget. It does not implement postmortem writes or imply Tasks/Apps/subscription support. No schema migration or new dependency is required for this checkpoint.

Fresh local PostgreSQL tests exercise the actual MCP executor and authenticated wire, including private resources, membership loss, scope/grant/account changes, history cursors, snapshot redaction, result/operation limits and weighted quota charging. Local results are distinct from CI and final release certification. Existing release gates continue requiring independently reviewed evidence for the final source SHA and image digest.
