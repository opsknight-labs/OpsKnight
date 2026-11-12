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
      Delivery and CI tracking: PR #928 carries live status; the snapshots below identify validated heads.

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

## Phase 7 implementation checkpoint (historical)

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

## Final-head CI follow-up

The first complete phase 0–7 remote head (`6917ffd5e`) is mergeable, but CI is not green.
The database jobs applied every migration, then the strict validator correctly rejected the
provider migration mixing enum additions and table DDL. The undeployed migration is split into
`20261030000650_intelligence_ai_provider_enum` and the existing governance migration; there are
now 16 feature migrations. The auth browser job now provisions an explicitly `_test`-suffixed
database, preserving the intelligence fixture's destructive-test guard. A WebKit MCP locator
is scoped to the active main content after CI found duplicate retained route text.
Docker build failures on this head still used the old 4 GB argument; the 6 GB fix is committed.
Automation continues to report 75 authoring failures, a separately recorded baseline issue.
Final follow-up push and rerun results remain pending.

## CI remediation — 2026-11-01

Remote head `212ea7ba8` completed with 56 successful checks and one failure, automation.
Current CI/MCP main (`bc67aeab2`) was integrated in `60b3933e2`, preserving main's four-shard
required test gate and moving browser certification to its new workflow. The auth browser job
retains an isolated `_test` database and 6 GB heap. The `ci:full` label is required for the heavy
suites under current repository guidance; final status is tracked on PR #928.

The automation UI now exposes existing audited privacy/Shadow-readiness settings and cleanup
recovery. Candidate review uses the server's actual recent-evidence, backlog and error policy,
and submits the reviewed settings revision. Browser fixtures wait for real ingestion receipt
completion, deliberately create an unmapped observation instead of relying on 5% sampling, and
wait for owned destinations' credential-free delivery failures before checking rendered status.
They open the Automation tab and scope context controls, exercise keyboard rule navigation and
use current named controls. The runbook upgrade workflow returns through application navigation
instead of racing a document navigation against a pending refresh.

Mobile axe checks exposed insufficient text contrast on badges, navigation, counts, conditions
and readiness guidance. These colors were corrected without disabling checks or relaxing budgets.

Local verification on Node 20: **96/96 automation browser cases passed in one clean production
run (6.1 minutes)** across Chromium, Firefox, desktop WebKit, Android, iPhone and iPad. This includes
axe, the 100-rule bounds/performance checks, notification/context authorization, API authoring,
candidate observation retry and activation, privacy opt-out and failed cleanup recovery. The
scoped component suites passed **65/65**, settings/readiness database suites **24/24**, and the
MCP/dashboard upstream checks **178/178**. Production build and zero-warning changed-source lint pass.
The first two-file database attempt ran resets concurrently and is not counted as a clean pass;
the 24-test result ran serially on a fresh disposable database, matching CI's execution model.
These local results do not imply a final-head CI pass or waive deployment certification gates.

Latest main `031bf0b96` adds MCP request-memory/query improvements and tolerant OAuth parameter
handling. After integrating those MCP-only changes, **185/185 MCP unit/protocol tests** and
**22/22 scoped MCP database tests** passed, along with typecheck and changed-source lint.
The 96-case automation browser result above exercised the final automation code; no automation
source changed in this subsequent upstream integration. The mandatory push hook checks the
complete combined source again. Final remote status remains authoritative on PR #928.

## MCP CI remediation — 2026-11-02

Remote head `d29dac93a` finished with 46 successful checks and one failure, MCP browser
validation. Automation, Swarm and the rerun of the transient Docker Hub emergency-recovery
failure passed. The remaining browser failure exposed unnamed scope controls, stale selectors
after the MCP settings redesign, and an omitted bulk-revocation confirmation field.

Manual-client scope groups and scope checkboxes now have stable plain-language accessible
names. Policy narrowing selects by the submitted scope value. Native connection tests use the
current heading and confirmation dialogs and scope retained-route text to the active content.
Bulk revocation submits the required confirmation only after the destructive dialog is confirmed;
server validation remains strict. The browser test proves cancellation preserves access and
confirmation revokes it.

A fresh isolated MCP database and two production servers passed **9/9 browser cases** in
54 seconds across Chromium, Firefox and WebKit, covering separate-user runbook approval,
automatic onboarding, PKCE consent, scoped calls and individual/bulk revocation. Scope-selector
and confirmation component tests passed **9/9**; typecheck, production build and zero-warning
changed-source lint passed. Final remote CI after the follow-up push remains authoritative.

The first follow-up CI head `de9f58541` passed eight of nine MCP browser cases. WebKit
interrupted the test's hard navigation to revoked connections with a pending application
refresh after revocation. A local repetition also exposed this timing race after quick setup.
The affected tests now navigate through the actual settings links and status filter instead
of starting a competing document navigation after a server action. The complete browser matrix
passed **9/9** again (51.8 seconds), followed by **6/6** additional WebKit onboarding/native
connection repetitions (three repetitions each, 33.8 seconds). Typecheck and zero-warning
changed-test lint passed. No product gate, assertion or browser coverage was removed.

The same CI head passed **95/96 automation browser cases**, with one Firefox field-removal
journey clicking Context while the initial overview load was still changing page layout. The
test now waits for the loaded readiness panel, clicks Context and verifies its selected state
before testing field removal and affected-rule navigation. The failing case passed **10/10
Firefox repetitions** (50.7 seconds) and **6/6 desktop/mobile profiles** (25.3 seconds).
Typecheck and zero-warning changed-test lint passed. The pending push was stopped before
transmission so both observed browser timing fixes can ship together.

Remote head `5af33838c` passed automation, Swarm, both required gates and all other
certifications. MCP's initial attempt timed out downloading Ubuntu browser dependencies;
the retry passed **9/9 native browser cases** (1.9 minutes), then correctly failed its
production dependency audit. Newly reported minimatch and follow-redirects advisories were
blocking under the existing empty-baseline policy.

Dependency overrides now use patched follow-redirects and a compatible modern glob/minimatch
chain. Workbox build/webpack, archiver and unzipper are updated together because injecting
minimatch 11 into legacy glob breaks its private regex assumptions. Real regression tests
exercise Workbox file matching, filelist and archive globs, and an Excel XLSX write/read
round-trip. Those and the existing audit-gate cases pass **9/9**; typecheck and zero-warning
changed-source lint pass. The unchanged production audit gate passes with **zero moderate,
high or critical findings** and 11 low findings, which the existing policy does not block.
No advisory exception or severity-policy change was added. The next push still requires
the full unit suite, production Workbox build and final-head remote certification.

The patched dependency set passed **10,868 unit tests**, seven skipped across 1,037 files.
The first build exposed unzipper's lazy optional S3 adapter being statically resolved by webpack.
ExcelJS now uses Next.js native server external loading, preserving that optional adapter's
lazy behavior. Production build and typecheck pass; zero-warning lint explicitly checks the
normally ignored Next config. The generated standalone artifact's own packaged ExcelJS also
successfully wrote and read an XLSX workbook, verifying archive dependencies are traced.

## Feature review and responder improvements — 2026-11-03

Reviewed the phase plan, queue/policy and similarity boundaries, actor-scoped views, Squire
stream contract, signed action execution and responder UI. The concrete gaps repaired in this
batch are interrupted-answer visibility, cancellation, proposal-expiry feedback and bounded
confirmation bodies. Existing server authorization, single-use receipts and expiry checks remain
mandatory; the UI adds no independent write path.

- Squire preserves partial answers when transport fails and explicitly marks incomplete streams.
  Final NDJSON events without a trailing newline are consumed, and readers release their locks.
- Responders can stop a running answer. Already received text stays available, late chunks are
  fenced out and focus returns to the composer for a follow-up.
- Action cards link to the affected incident, display the confirmation deadline and stop offering
  expired write suggestions. An action already in flight keeps its result when the deadline passes.
- The confirmation route uses the existing streaming JSON byte limit, cancelling oversized chunked
  bodies before executing an action, including bodies without Content-Length.
- The remaining auth CI failure was a synthetic two-minute clock jump expiring webpack's pending
  chunk timeout. Sequential timer progression retains the heartbeat contract and route assertions.

The scoped Squire/body suites passed **49/49**; the broader Intelligence unit pass was **292/292**.
Production build, typecheck and zero-warning changed-source lint passed. The final combined
production-browser run passed **36 cases, four skipped**, including **9/9 Intelligence workflows**
and the complete navigation suite. Its new real-provider-stream mobile case proves cancellation
preserves the answer and settles the token reservation before the delayed provider finishes, with
axe and 390-pixel overflow checks. The mobile screenshot was visually inspected. An earlier
mixed-fixture run is not counted; final browser evidence uses a dedicated freshly migrated database
and the same application-origin environment as CI. Final-head remote checks remain authoritative.

## Roadmap foundation — 2026-11-03

The follow-on roadmap is tracked separately in `next-capabilities-plan.md`; its eleven work packages
are not complete. This first implementation batch reproduces and closes the Internal-only provider
fallback for free-text conversation turns. Browser and legacy saved messages require Personal clearance;
without an eligible provider, Squire explains the policy and uses basic mode with no model request.
The browser regression also reproduced stale provider clearance across route bundles. Gateway resolutions
now share concurrent reads only and reload policy for subsequent requests, eliminating the five-second
TTL window without relying on process-local invalidation.
Synthetic canaries verify both browser history and saved history after a provider policy change.

Saved conversations now retain their incident/global binding across storage writes and streaming.
A mismatched stream is rejected before provider egress; appending in another context creates a separate
conversation. Opening saved history from another incident shows an explanation instead of silently
retagging its messages. History loading no longer performs network work inside a React state updater.

Local foundation verification: 80 database cases (including 28 security/red-team cases) and 98 gateway/Squire/API/architecture unit cases
passed. Typecheck, zero-warning changed-source lint and production compilation passed.
All 11 production-browser responder workflows passed, including both new regressions, axe and the
existing 390 px checks. Remote CI evidence for this batch must be recorded after its run finishes. The first remote pass found
three red-team fixtures still using Internal-only clearance; their AI scenarios now explicitly use
Personal clearance, preserving all authorization, secret-redaction and proposal-only write assertions.

Still open: typed classification/envelopes, durable action lifecycle/reconciliation, full context-switch
UX and permission-revocation replay policy, shared retrieval/evidence, freshness, evaluations/feedback,
onboarding, communications drafts, operator recovery and opt-in handoff briefings. Existing independent
release gates remain unchanged.

The expanded responder browser group also exposed successful-login rate-limit exhaustion in the combined
CI job. Its fixture now signs in normally once and reuses only its own in-memory session cookies across
responder scenarios. Production authentication/rate limits and the separate authentication scenarios are
unchanged. A clean combined CI-mode production-browser run passed 38 cases with four skipped, including
all 11 Intelligence workflows.

## Durable action outcomes — 2026-11-03

Added a versioned receipt lifecycle with encrypted immutable intent/result, safe failure category and
execution timestamps. Legacy consumed receipts default to UNKNOWN. All five current write actions now
commit their success receipt and Squire audit inside the native mutation transaction; lifecycle commands
also use stable proposal-scoped idempotency keys. Transaction-bound preconditions reject changed lifecycle
generations, assignments and relationship decisions. Unknown attempts remain consumed and are never
resumed automatically. Native domain commands retain their existing authorization and outbox boundaries.

A bounded owner-only result endpoint rechecks current incident visibility, rejects API keys and cross-site
requests, and remains usable after proposal expiry for one day. Action cards restore results after remount,
block uncertain reconfirmation and offer read-only Check result. The browser test deliberately loses the
response after the real note transaction commits, then recovers it and reopens the panel without a second
mutation. New encrypted columns are registered for privacy and key rotation.

Local evidence: 42 action/correlation database cases plus the native event-lifecycle integration case
(including fault injection at reservation and native commit boundaries), 91 scoped unit/component/architecture
and native API cases and all 11 production-browser Intelligence
workflows passed. The full follow-on roadmap remains incomplete; saved-history outcome references depend
on structured memory in P1-03.

The preceding remote head 1e7b2243e passed 46 checks (including both required gates and authentication)
with 12 skipped and one runbook browser failure. Its exact failing selector matched more than one
Create objective section. Scoping to visible main-content details and the direct summary preserved the
entire objective-version/archive assertion; six repeated Chromium/Firefox/WebKit cases passed locally.
This is a repaired observed CI failure, not a reason to weaken a check or skip the scenario.
