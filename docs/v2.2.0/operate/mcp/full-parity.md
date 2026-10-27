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
5. Implement modern Tasks with per-request capability negotiation, durable grant-bound receipts, status/update/cooperative cancellation and worker recovery. Reuse native execution/leases where possible. No task handle or Tasks capability is advertised yet; a native runbook execution is durable, but that alone is not the Tasks extension.
6. Complete authorized resources, versioned prompts, completions and safe multi-round-trip input. Add separately bounded modern subscription capacity and cross-replica wakeups; streams must never hold database transactions. Optional Apps require a sandbox and ordinary tool/resource fallback. Code Mode stays disabled pending separate certification.
7. Run security/dependency remediation, baseline comparisons for unrelated CI failures, migration/rollback drills and fault injection. Measure 0/10/25/50/100 MCP concurrency while ingestion, paging, delivery and runbooks operate. Record latency, SQL time/count, locks, connection waits and critical backlog; pool separation and query counts alone are insufficient.
8. Package admin policy/retention controls, client guides, support matrix and exact-source/image evidence. Keep the PR draft until all required CI, interoperability, recovery and production gates pass.

## Generic approval checkpoint

Phase D now has its reusable engine: `McpOperationApproval` (additive migration), the `APPROVAL_REQUIRED` review status (R2 only), `operation_prepare` / `operation_get_approval` / `operation_commit_approved`, and a native review page. The engine is exercised by `tests/integration/mcp-operation-approval.test.ts` for same-reviewer rejection, reviewer demotion or token-version change, requester grant revocation, writes disabled, digest/envelope tampering, expiry, stale revision, wrong grant, concurrent commit and crash recovery. Three operations are enabled (`setTeamLead`, `updateServiceSupportHours`, `createStatusPageAnnouncement`). The remaining R2 writes must each be enabled only with family-specific tests. R2 reads, R3 destructive operations (which additionally need recent re-authentication and postcondition verification), reviewed exclusions, Tasks, subscriptions and Apps are not part of this checkpoint.

## OAuth checkpoint

CIMD is implemented behind an administrator policy (`cimdEnabled`, exact `cimdAllowedHosts`, `cimdScopes`; additive migration, default off) with an SSRF-resistant pinned fetch and immediate trust-policy revocation (see the catalog reference). Unit tests cover URL canonicalization, address classification, redirect/oversize/DNS-rebinding rejection and document validation; `tests/integration/mcp-client-metadata.test.ts` covers policy, scope ceiling, sticky revocation, identity squatting and grant invalidation. Still open for Phase B: issuer-bound credential validation beyond the existing resource check, scope step-up/incremental consent, a decision on legacy DCR and 2025-era compatibility, and certification against real clients.

## Previous checkpoint

The postmortem read workflow adds contributor and paginated history adapters, a bounded four-source context tool and a scoped resource template. It preserves private-parent authorization, fresh revocation, redaction, native quotas and the request budget. It does not implement postmortem writes or imply Tasks/Apps/subscription support. No schema migration or new dependency is required for this checkpoint.

Fresh local PostgreSQL tests exercise the actual MCP executor and authenticated wire, including private resources, membership loss, scope/grant/account changes, history cursors, snapshot redaction, result/operation limits and weighted quota charging. Local results are distinct from CI and final release certification. Existing release gates continue requiring independently reviewed evidence for the final source SHA and image digest.
