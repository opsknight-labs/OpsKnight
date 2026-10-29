# Intelligence completion ledger

Delivery: `feat/intelligence-engine`, PR #928. Never merge this branch automatically.
The user requested continuation through all phases; a phase push is not the end of this work.

- [x] Phase 0: existing work landed, main integration and migration ordering, MCP catalog registration.
- [x] Phase 1: queue generations, retries, transaction/indexing consistency, OFF policy, retention,
      singleton jobs, deterministic anchors and content score floor (existing implementation).
- [x] Phase 2: stored FTS, GiST retrieval, optional ANN/fallback, read caching and storm harness
      (existing implementation; final 1M-history measurement still pending below).
- [x] Phase 3: gateway/Squire hardening (existing implementation; reservation accounting audit pending).
- [x] Phase 4: lazy client launcher; parallel preparation and deferred persistence; bounded request
      streaming; semantic and status-page tools; opt-in live-model evaluation suite. Existing confirmed
      actions, briefing, progress, citations and history remain in place.
- [x] Phase 5: topology grouping with configurable minimum scores, change baselines and component
      matches, transactional downstream late-change re-analysis, idempotent outcome patterns, seasonal/flapping
      detection, outcome/MTTR runbook ranking and manually published feedback-trained weights.
- [ ] Phase 6: shadow quality, service certification gate, post-paging reversible AUTO grouping.
- [ ] Phase 7: tabbed panel, skeletons, runbook and relationship controls, explanations, search fix,
      phone-width and axe coverage.
- [ ] Final verification: nonincremental typecheck, changed-source lint, all intelligence suites,
      MCP/SDK checks, pgvector, browser workflows, 1M-history storm, A/B and EXPLAIN evidence.
- [ ] Update architecture, responder/operator guides, certification ledger and PR description.
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

Further audit items to close with the remaining work: atomic token reservations (existing admission
checks are soft), action receipts after uncertain failures, and final CI/build memory settings.
