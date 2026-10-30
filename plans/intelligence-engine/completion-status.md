# Intelligence completion ledger

Delivery: `feat/intelligence-engine`, PR #928. Never merge this branch automatically.
The user requested continuation through all phases; a phase push is not the end of this work.

- [x] Phase 0: existing work landed, main integration and migration ordering, MCP catalog registration.
- [x] Phase 1: queue generations, retries, transaction/indexing consistency, OFF policy, retention,
      singleton jobs, deterministic anchors and content score floor (existing implementation).
- [x] Phase 2: stored FTS, GiST retrieval, optional ANN/fallback, read caching and storm harness
      (existing implementation; final 1M-history evidence recorded below).
- [x] Phase 3: gateway/Squire hardening, atomic reservations and single-use action receipts.
- [x] Phase 4: lazy client launcher; parallel preparation and deferred persistence; bounded request
      streaming; semantic and status-page tools; opt-in live-model evaluation suite. Existing confirmed
      actions, briefing, progress, citations and history remain in place.
- [x] Phase 5: topology grouping with configurable minimum scores, change baselines and component
      matches, transactional downstream late-change re-analysis, idempotent outcome patterns, seasonal/flapping
      detection, outcome/MTTR runbook ranking and manually published feedback-trained weights.
- [x] Phase 6: shadow quality, service certification gate, post-paging reversible AUTO grouping.
- [x] Phase 7: tabbed panel, skeletons, runbook and relationship controls, explanations, search fix,
      phone-width and axe coverage.
- [x] Final verification: nonincremental typecheck, changed-source lint, all intelligence suites,
      MCP/SDK checks, pgvector, browser workflows, 1M-history storm, A/B and EXPLAIN evidence.
- [x] Update architecture, responder/operator guides and certification ledger.
- [ ] Update final PR description and CI results.
- [ ] Push final implementation and inspect final-head CI.

## Phase 4 evidence

Local Squire unit/component tests: 50 passed. Squire/history/confirmed-action integration tests:
27 passed before adding the two read tools; the updated Squire suite then passed 13 tests, including
semantic candidate visibility and status-page authorization. Architecture/route regression tests:
29 passed. Full nonincremental typecheck and changed-source ESLint passed.

`npm run test:squire:eval` discovers only six labelled live cases. All six skip when
`SQUIRE_EVAL_API_KEY` is absent; no live-model result is claimed. With a key, use a disposable migrated
database ending in `_test`; the suite resets it. Model/base URL are configurable with
`SQUIRE_EVAL_MODEL` and `SQUIRE_EVAL_BASE_URL`. Results contain scores/timing only in
`reports/squire-eval.json`.

## CI baseline investigation

The first resumed push exposed build heap exhaustion at about 4 GB. Whole-repository local lint also
reports 21 errors and 552 warnings in existing files. This is distinct from the zero-warning
changed-source gate. Neither result is waived or represented as a passing release gate.

## Phase 5 evidence

The full intelligence database run exercised 304 cases: 301 passed initially. Follow-up suites for the
three regressions (new read-tool allowlist, cross-service scoring, derived-pattern retention) passed
49/49 after correction. The full final-head run remains part of final verification. Changed-source
ESLint, schema validation and a nonincremental typecheck passed. Intelligence and dashboard regression
unit tests passed 279/279. The dashboard catch-up test now allows for its existing bounded timer jitter.

Migration `20261029001400_intelligence_quality` was applied to the dedicated test database. It adds
pattern statistics, a fingerprint aggregation marker and change metadata/indexes without rewriting
incidents. Outcome tests cover concurrent indexing, replay, reopening, retitling, OFF suppression and
secret redaction. Scoring tests verify proposals remain inactive until an audited, revision-locked
policy publication.

The 1M-history/10k-storm run uses a separate disposable database. Its harness now stamps the current
engine version and suppresses periodic sweeps on every cycle, so a longer run does not accidentally
become a million-incident re-index benchmark. Results are pending, not certification evidence.

The later phase 6/7 audit closes atomic reservations, uncertain-action receipt replay and CI heap settings.

## Phase 6 evidence

AUTO is scoped to an explicitly published service override. Global AUTO stays unavailable. Certification
uses only explicit human-reviewed pairs from the last 30 days, pins the engine, definition and active
dependency graph, expires after seven days, and invalidates on new reviews. It requires 200 predictions,
20 negative labels, 20 critical labels, 98% precision, a 95% Wilson lower bound, at most 1% false merges,
at least 50% recall, zero critical false merges and passing coverage for every enabled rule. Topology
rules additionally require reviewed cross-service predictions. A measurement never enables AUTO itself.

The handler waits behind the initial paging outbox, excludes HIGH and historical incidents, records
accepted RELATED children and immutable automatic decision events, and leaves incident and paging rows
unchanged. Human undo invalidates certification and prevents automatic replay of the withdrawn link.
Settings expose quality and the service gate. Synthetic reviewed fixtures verify these controls; they
are test evidence, not production service certification.

The existing gateway/policy/correlation/Squire suites passed 59/59. Reservation, confirmed-action and
relationship suites passed 27/27; AUTO certification tests passed 3/3 and pure quality tests 4/4.
Atomic daily reservations now include concurrent global and personal usage, settle once on the reserved
UTC day, and cover chat, structured calls, streams, embeddings and provider tests. Failed/aborted calls
are charged estimated usage. Single-use action receipts remain consumed after uncertain failures.

The million-history fixture was restarted after identifying a production SLA trigger hot-row problem
in one enormous fixture transaction. It now seeds in bounded committed batches with triggers enabled.
Seeding time is separate from the measured queue-drain interval.

## Phase 7 implementation and verification in progress

The incident page now uses one accessible tabbed panel with skeletons, explanatory empty states,
expandable match reasons, Mark related, Group these/Ungroup and the native runbook launcher preselected
for the suggested runbook. Accepted links remain visible for undo while OFF. Sidebar search matches AI
as a word. Change/alert citations use visibility-checked detail pages. Recent timeline events are
prefetched only into Personal-provider context; a regression verifies Internal providers receive none.

Current unit/component/architecture checks passed 33/33, timeline/boundary checks 36/36 and Squire
integration 14/14. The fresh pgvector database passed semantic 10/10 and new source/quality/retention
checks 28/28. MCP passed 71/71, SDKs 13 TypeScript + 10 Python, generated API clients, Prisma validation,
docs contracts and performance budgets passed. The live-model suite skipped six cases without a key.

The first full database run passed 307/313 while source was still being completed. Isolated follow-up
covered its failures: 50/51 initially passed; the remaining cross-service retrieval fixture was made
unambiguous for the new IDF weighting and the following similarity/Squire run passed 38/38. Default
queue scheduling and operator replay now use database time; a five-minute application-clock-skew test
passes. The previous use of application time caused immediate claims to intermittently return empty.

A 6 GB production build passed. Five browser workflows pass; source-page rendering, OFF undo and
streamed confirmation/replay are still being finished. The browser tests now account for the app's
retained hidden route content using accessible-role selectors. No final browser pass is claimed yet.
The build/typecheck workflows set a 6 GB Node heap, addressing observed 4 GB heap exhaustion without
weakening checks. Latest-main integration and final validation follow this implementation checkpoint.

## Final local evidence — 2026-10-30

Integrated main `b5b6f3797` as feature-branch merge `2d0799f1b`, preserving the postmortem AI draft
flow and upstream Zod 4 migration. The changes webhook retains the existing integration handler's
Zod 3 contract. All 15 undeployed feature migrations now follow main's `20261030000100` migration,
in their original relative order (`20261030000200` through `20261030001600`). A new disposable
pgvector database applied the complete migration chain successfully.

On Node 20.20.2, the complete unit suite passed 10,771 tests with seven skipped across 1,023 files,
with forks bounded to two. The full fresh-database intelligence suite passed **317/317** across 29
files, including pgvector and all final regressions. Before the bounded rerun, an oversubscribed
unit run reported worker timeouts; it is not counted as a clean pass. The pre-push hook now bounds
forks while retaining every test. Nonincremental typecheck, full changed-source lint, generated API
clients, schema validation, documentation contracts and production build pass.

Final regressions additionally cover: default enqueue/replay under a five-minute application clock
skew; an empty AUTO group's sliding window when paging crosses a bucket boundary; globally readable
service changes (Prisma must not receive an empty service filter inside OR); source-page visibility;
Personal-only timeline prefetch; retained action receipts after uncertain failures; and ranking an
older relevant change behind more than 5,000 newer changes.

The full Node 20 production-browser run passed **8/8** in 25.1 seconds, including settings/quality,
feedback, keyboard tabs, source pages, undo while OFF, streamed propose/confirm/replay, 390 px and axe.
The last selector now accounts for the checkbox's accessible description. MCP checks after main
integration passed **107/107**; SDK checks passed **13 TypeScript + 10 Python**. Documentation and API
client generation checks passed. No real-model result is claimed: six evaluation cases skip without a key.

The 1M-history/10k-storm run completed in **280.7 s**, with zero failures and zero dead letters.
Similarity p50/p99 was **88.9/249.7 ms**. Eight paired ingestion A/B repetitions kept the candidate lane
active throughout every measured arm and had zero ingestion failures. Raw reports and query plans:
`certification/2026-10-30-local/`. These shared-host measurements are indicative, not deployment
certification. The initial broad-OR storm and inactive-lane A/B attempts are not represented as final
evidence. Full-text retrieval now uses the two most informative terms as an AND-style web search.

Six live-model evaluation cases skip without `SQUIRE_EVAL_API_KEY`. Production human-labelled service
quality, independent security review, dedicated hardware, fault/rollback drills and live-provider/mail
checks remain deployment gates, not unimplemented feature phases.

## Final upstream integration and push verification

Integrated main `a7f40f7c4` (MCP compatibility fixes) as feature merge `6917ffd5e`. The
MCP suite passed **116/116**. The complete final push hook then passed **10,780 unit tests**,
with seven skipped across 1,024 files, typecheck and the production build. That implementation
was pushed to PR #928. The fresh-database and browser evidence above remains applicable; the
last upstream changes affect MCP authentication and have their own regression suite.

All four failures on the previous remote head were build/typecheck heap exhaustion. Workflows
and the shared build action now allow 6 GB. The Swarm image uses a separate Docker build argument;
its default is also raised from 4 GB to 6 GB. Docker's build check passed without warnings, and
the local production build already passed with the same 6 GB heap. Final-head CI must validate
the actual container build and integration workflows; no CI pass is inferred from local checks.
