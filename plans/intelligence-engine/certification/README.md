# Intelligence engine: certification status

**Status: NOT DEPLOYMENT-CERTIFIED.** Implementation covers phases 0–7 on
`feat/intelligence-engine`, PR #928. Per-service AUTO has a runtime quality gate; passing synthetic
tests does not certify a production service or a deployment. No pre-paging hold is implemented.

## Current implementation

Intelligence is disabled by default and configured in Settings. It provides lexical and optional
semantic precedents with resolution details, dependency-aware correlation, change-source baselines,
component matching, transactional late-change analysis, outcome/MTTR runbook ranking, persistent
outcome patterns, seasonal/flapping insights, manually adopted scoring proposals and an opt-in digest.

Squire offers bounded, permission-checked read tools, preloaded incident context, progress events,
validated source links, optional encrypted history and signed action proposals. Confirmed actions call
existing application commands under the confirming person's permissions. The model cannot execute
mutations. Single-use receipts survive uncertain failures. Runbooks retain their native preview and
approval workflow. Chat, structured requests, streams, embeddings and connection tests use atomic
global/personal token reservations with idempotent settlement and estimated accounting on failure.

The incident panel has keyboard-accessible tabs, skeletons, explanatory empty states, expandable
match reasons, manual linking, group/ungroup controls and runbook launchers.

## Runtime service certification

Settings → Intelligence → Quality measures explicit USER decision events over a 30-day window,
limited to 2,000 reviewed pairs. It does not infer negative labels from missing reviews. Certification
pins the immutable policy definition, engine version and active dependency graph. It expires in seven
days and invalidates on later human decisions. Measuring or certifying never enables AUTO itself.

The gate requires:

- At least 200 predictions, 20 negative labels and 20 critical-alert labels.
- Precision ≥98%, Wilson lower bound ≥95%, recall ≥50%, false merges ≤1% and zero critical false merges.
- At least 100 passing reviewed predictions for every enabled rule; topology additionally needs passing
  cross-service predictions.

Only a separately published service AUTO override can create accepted RELATED children. Global AUTO
remains unavailable. HIGH, resolved, old and expired-group cases are excluded. Pending initial paging
requeues intelligence without changing paging jobs. Automatic creation and anchor re-election append
decision events. Human undo invalidates certification and vetoes automatic replay; accepted links stay
visible for undo while OFF.

## Verification evidence

Phase 5 passed the full pre-push unit suite and production build. Its database regression corrections
passed 49/49; final view/quality/Squire checks passed 24/24. Phase 6 passed 59 existing gateway, policy,
correlation and Squire tests; 27 reservation/action/relationship checks; three AUTO certification tests;
and four pure quality checks. The full phase 6 pre-push unit run passed **10,733 tests with seven skipped
across 1,016 files**. Its production build and push are tracked in the completion ledger.

The latest nonincremental typecheck and whole-branch changed-source ESLint check passed before final
verification. These checks are rerun for subsequent source edits. Whole-repository lint has inherited
debt (21 errors and 552 warnings at the resumed baseline); the existing CI reports it separately and
blocks on changed-source lint. This PR does not waive that debt.

Final Node 20 local verification: **10,780 unit tests passed, seven skipped; 317/317 intelligence
database tests passed** on a fresh pgvector database. The production build, nonincremental typecheck,
changed-source lint, API generation and docs contracts pass. All **8/8 production-browser workflows passed**, including confirmed mutation and replay protection,
phone width and axe. MCP checks passed **116/116** and SDKs **13 TypeScript + 10 Python**.
The completion ledger records final-head CI separately; local passes do not claim CI certification.

The million-history/10k-storm run drained in **280.7 seconds**, zero failed items and zero dead letters;
similarity p50/p99 was **88.9/249.7 ms**. Active-lane ingestion A/B used eight paired repetitions and
24,000 successful ingestion attempts. Raw evidence and measurement limits are in
`2026-10-30-local/README.md`. Earlier oversubscribed/mixed-source runs are not counted as clean passes.

Earlier checkpoint: 298 intelligence database tests, 71 MCP tests, 13 TypeScript and 10 Python SDK tests,
API client generation, changed-source lint, typecheck and build passed before phases 4–7. Those results
are historical and do not claim final-head certification or current CI status.

## Repeatable verification

Use isolated migrated databases ending in `_test`; the integration/browser/load fixtures delete data.

- `npx tsc --noEmit --incremental false` and ESLint on the complete branch diff with zero warnings.
- Full Vitest unit suite and `vitest.int.config.ts` intelligence integration directory.
- Repeat semantic tests on PostgreSQL with pgvector installed and without it.
- `tests/e2e/intelligence-ui.spec.ts` against a production build: settings/quality, feedback, tab keyboard
  controls, scoped source pages, undo while OFF, streamed propose/confirm/replay, 390 px and axe.
- MCP/SDK suites, `api:clients:check`, Prisma schema/migrations and documentation checks.
- `tests/load/intelligence-storm.ts --history 1000000 --burst 10000 --services 50` records p50/p99 and
  drain time. Seeding commits bounded batches with production triggers enabled. `--reuse-history`
  validates history size/engine, replaces only the burst and keeps its seeding time separate.
- Alternating ingestion A/B with at least eight repetitions, paired bootstrap comparison and recorded
  query plans. Shared development hardware gives indicative evidence only.

`npm run test:squire:eval` discovers six labelled real-model cases and skips without
`SQUIRE_EVAL_API_KEY`. It uses synthetic fixtures in a disposable database; the report contains scores
and timing. No live-model result is claimed when the key is absent.

## Deployment gates still outstanding

Production-labelled service quality, dedicated-hardware ingestion performance, fault/failover and
rolling-restart drills, clock skew, operational rollback drill, independent security review, real
responder usability, assistant load, semantic quality/cost, live native-provider endpoints and digest
mail deliverability remain deployment evidence to collect. Real-model evaluation also requires an
explicit evaluation key. Passing local tests does not waive any of these gates.

Unconfirmed assistant writes, automatic rule adoption, a mandatory vector extension and a pre-paging
hold are outside the implementation. Native MCP exposure from #924 is integrated; this branch registers
its intelligence read tool in the classification catalog and validates generated API artifacts.
