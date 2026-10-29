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
- [ ] Phase 5: finish topology grouping, change baselines, outcome patterns, seasonal/flapping
      detection and manually published feedback-trained weights.
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
