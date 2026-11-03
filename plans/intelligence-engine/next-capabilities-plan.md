# Intelligence and Squire: next capabilities and hardening plan

Reviewed: 2026-11-03 · Baseline: `772279f72` · Scope: Intelligence engine, Squire, responder UX and operational readiness.

Implementation has started. The initial foundation batch closes the reproduced Internal-provider conversation fallback and adds incident/global scope checks in storage, streaming and the saved-history UI. The remaining acceptance criteria below are still open; this document does not claim all eleven packages are complete. Findings below distinguish observed code behavior, risks that require a reproducer, product extensions and deployment gates. A passing CI run does not establish that every useful capability exists.

## Recommendation

Start with **P0-01 provider/history data boundaries** and **P0-02 recoverable action outcomes**. Then fix conversation context and retrieval/provenance before expanding the assistant's write surface. Existing paging, authorization, native runbook approvals and per-service AUTO certification remain authoritative.

The initial vertical slice should prove one private-history boundary and one recoverable `add_incident_note` action. Do not begin by adding autonomous remediation, weakening AUTO thresholds, replacing the queue or adding a second generic agent framework.

## What already exists

- Indexed lexical/trigram retrieval and optional pgvector/HNSW in the engine; scoped exact fallback; explainable ranking and feedback.
- Queue generations, retries, leases, backpressure, retention, dead-letter listing **and manual replay**. These are not missing features.
- Similarity, related incidents, change correlation, runbook ranking, outcome patterns and insights.
- Data-driven per-service AUTO gates with expiry and policy/topology invalidation. AUTO is reversible and remains after paging.
- Squire read tools, streaming, cancellation, visible interruptions, basic-mode fallback, encrypted opt-in history and bounded requests.
- Five confirmed write actions: acknowledge, resolve, note, reassign and link. Runbook and postmortem suggestions open native review pages.
- Proposal deadlines, actor-scoped confirmation, single-use receipts, citation links, provider controls, token reservations, OTel spans and usage charts.
- Weekly digest, feedback-driven weight proposals and a six-case opt-in live-model evaluation harness.

Do not rebuild these under new names. The roadmap extends their weakest boundaries and missing user workflows.

## Evidence and confidence

**Observed** means the behavior is visible in the cited implementation; it does not imply a production incident was observed. **Risk** means the code path exists but impact needs a targeted regression test. **Extension** means intentionally new capability. Estimates are rough engineering effort for one engineer familiar with the repository, excluding external review, production labeling and credentials. They are not calendar commitments or additive project forecasts.

## P0-01 — Carry data classification through conversation history

**Implementation progress (2026-11-03):** synthetic provider-payload tests reproduced the fallback. Conversation turns now require Personal clearance and otherwise remain in basic mode. A production-browser regression also reproduced the gateway's stale-clearance TTL; subsequent resolutions now reload persisted policy. Typed per-turn classification/envelopes and independent security review remain open.

**Finding: observed data flow; privacy impact needs a reproducer.** `squire/chat.ts` prepares history independently of provider selection. It first tries a Personal-capable provider, falls back to Internal, removes prefetched timeline and Personal tools, but still spreads `history` into the outgoing messages. `priorTurns()` returns saved or client-supplied text without per-turn classification. Gateway `toMessages()` redacts secrets; that does not establish that text is free of Personal data. The existing integration test covers prefetched timeline exclusion, not history carried over from a previous Personal turn.

**Build:**

- Classify the complete outgoing context, including user messages, saved history, tool evidence and summaries. A lower provider ceiling must never lower the content's classification.
- Default legacy/unclassified saved context conservatively; do not infer Internal merely because a Personal provider is unavailable.
- For insufficient provider clearance, either omit the disallowed context with an explicit user notice or use basic mode. Choose and document the product behavior before implementation.
- Persist classification/provenance with encrypted message metadata and keep it through truncation or summarization. Do not log raw history to prove exclusion.

**Acceptance:** generate a Personal answer containing a synthetic canary, switch to an Internal-only provider, continue through both saved and browser history, and inspect the fake provider's received payload. The canary must never leave via the Internal path. Cover cross-provider fallback, history on/off, legacy rows, redaction, deletion and cancellation.

**Touchpoints:** `src/lib/intelligence/squire/chat.ts`, `ai/port.ts`, `ai/gateway.ts`, `conversations/store.ts`, Prisma conversation/message models; `tests/integration/intelligence/squire.test.ts` and `squire-history.test.ts`.

**Dependencies / effort:** first; approximately 3–5 engineering days after a bounded reproducer. Release blocker if the test confirms disallowed egress. No actual customer-data disclosure was demonstrated in this review.

## P0-02 — Recover the result of an uncertain confirmed action

**Implementation progress (2026-11-03):** versioned encrypted receipts, owner-only read-only recovery, atomic success/audit commits for all five current write actions, native lifecycle idempotency keys and transaction-bound stale-intent checks are implemented. Browser fault injection proves recovery after a lost commit response and close/reopen; concurrency and transaction-failure tests cover the domain boundaries. Saved-conversation outcome references remain part of P1-03; independent review is still a release gate.

**Finding: observed recovery gap.** `executeSquireAction()` inserts a single-use receipt before calling the domain command. A duplicate returns “This has already been done.” The receipt model stores identity/action/incident/time, not execution status or result. A crash after reservation but before execution, an action failure and a committed mutation whose response was lost cannot be distinguished through that response. Keeping the receipt is the correct duplicate-prevention choice; deleting it or blindly retrying would be unsafe. Audit writes are best effort and are not a reliable recovery ledger.

**Build:**

- Introduce a versioned lifecycle: reserved/running/succeeded/failed/unknown, with actor, target, immutable intent, result, timestamps and safe error category.
- Add owner-scoped, read-only result lookup that remains useful after proposal expiry. Never allow an expired token to authorize a new mutation.
- Start with note creation. Carry a command idempotency key into the existing domain transaction so receipt reconciliation can identify the actual outcome. Extend to other actions only after proving their domain semantics.
- Store success and its result atomically with the mutation where the domain transaction permits it. Use explicit reconciliation for boundaries that cannot be atomic; do not claim exactly-once behavior from a receipt insertion alone.
- Present “completed”, “still running” and “result unknown” distinctly. Preserve review/outcome state when the panel closes or a saved conversation reopens. Recheck permissions before showing outcomes or offering any recovery action.
- Bind relevant target preconditions to intent and require fresh review when they change. Do not overwrite a newer assignment just because an old proposal remains within its TTL.

**Acceptance:** crash/fault injection before reservation, after reservation, before/after domain commit and before response delivery; concurrent confirmations; role revocation; stale target; expiry; close/reopen. At most one domain effect, a truthful outcome, and no automatic retry of unknown writes.

**Touchpoints:** `squire/actions/execute.ts`, `proposals.ts`, `SquireActionReceipt`, native note/assignment/lifecycle/link commands, action route, `SquireProposalCard.tsx` and launcher turn state.

**Dependencies / effort:** can follow P0-01; approximately 8–12 days for the first recoverable action plus the remaining current actions. Split by domain; avoid a large all-actions transaction rewrite.

## P1-03 — Make conversation context explicit and retain structured memory

**Implementation progress (2026-11-03):** storage and streaming now enforce incident/global context binding, and the saved-history UI explains mismatches instead of retagging messages. Structured envelopes, source-permission replay policy and richer context-switch navigation remain open.

**Finding: observed UX/data-model gap.** Saved conversations have a single optional `incidentId` and text-only messages. `openSaved()` loads their text and tags it with the incident currently being viewed. Server `priorTurns()` looks up an owned conversation without comparing its context to the requested incident. This can mix topics and loses citations, action outcomes and notices. It is not, by itself, proof of unauthorized access: ownership and scoped tools already exist.

**Build:** define global versus incident conversation scopes and explicit context-switch behavior; show “Discussing incident …” separately from the page being viewed. Preserve source context per turn. On a mismatch, offer a new conversation or explicit continuation instead of silently relabeling history. Store encrypted, versioned turn envelopes containing text, source handles, safe action receipt references, completion state and classification. Never persist reusable sealed action tokens as executable history. Specify how permission revocation and source deletion affect replay.

**Acceptance:** open incident A's conversation while viewing B; navigate during streaming; change membership; delete a source; reopen after retention or key rotation. No silent retagging, wrong-target confirmation or metadata loss. Old text-only rows still load conservatively.

**Touchpoints:** `SquireLauncher.tsx` (`openSaved`, `send`), `conversations/store.ts`, `squire/chat.ts`, conversation routes and models.

**Dependencies / effort:** P0-01 classification and P0-02 outcome contract; approximately 4–7 days.

## P1-04 — Give Squire the engine's retrieval quality at scale

**Finding: observed capability mismatch.** The engine supports indexed ANN retrieval, while `semantic_search_incidents` in `squire/tools.ts` fetches at most the newest 500 visible embeddings in 90 days and computes dot products in application code. An older relevant incident can be omitted regardless of similarity. This is a recall limitation, not a demonstrated latency failure.

**Build:** extract/reuse a shared semantic query service with query-vector input, model/dimension compatibility, visibility constraints, date/service/status filters, DB budgets and cancellation. Apply visibility before the effective top-k; filtering an unrestricted top-k afterward can starve authorized results. Keep the optional-pgvector path and bounded fallback. Return retrieval tier, coverage/truncation and evidence identifiers so the assistant can qualify incomplete searches. Do not simply remove `take: 500`.

**Acceptance:** a relevant incident outside the newest 500 is found with ANN; hidden incidents never influence returned evidence; mixed models/dimensions are excluded; no-vector and timeout paths degrade predictably; interrupted searches release work. Benchmark recall and p50/p99 separately on the existing 1M-history fixture, with paging isolation retained.

**Touchpoints:** `squire/tools.ts`, `semantic/search.ts`, `semantic/vector.ts`, `similarity/retrieval.ts`, scoped filters and DB-budget helpers.

**Dependencies / effort:** context/evidence contracts agreed; approximately 4–7 days. Set performance budgets from measurements, not a guessed target.

## P1-05 — Ground claims in retrieved evidence, not just readable links

**Finding: observed limitation.** `citationsFor()` extracts incident/runbook/change/alert ids from answer text and checks visibility. This prevents unreadable citation links, but a readable link can still be unrelated to a claim or never have been used by the model. Suggested follow-ups are currently deterministic context templates, not answer-specific suggestions.

**Build:** mint bounded evidence handles for actual tool/briefing results with source version/time and classification. Let the model reference those handles, then validate them server-side and recheck visibility. Distinguish evidence, inference and suggested next action; avoid describing a correlated change as a proven root cause. Show compact “why this source” and freshness details. Generate optional answer-specific follow-ups only when validated; retain deterministic defaults.

**Acceptance:** a hallucinated but readable id is not presented as supporting evidence; a real source cannot be attached to an unsupported claim without qualification; changed/deleted/revoked sources are handled; injection text remains data; the full evidence budget fits provider limits. Accessible source chips work on mobile.

**Touchpoints:** `squire/contract.ts`, `chat.ts` (`citationsFor`, `followUps`), tools, prompt, gateway events and launcher rendering.

**Dependencies / effort:** P0-01 and shared evidence contract with P1-03/04; approximately 4–7 days.

## P1-06 — Show freshness and analysis state on the incident

**Finding: observed UX gap.** Existing empty states correctly distinguish OFF, SHADOW and unindexed incidents. After a fingerprint exists, the generic “No qualifying matches yet” does not expose pending analysis, a stale result, a paused lane or exhausted work. Existing queue metrics and admin replay should be reused rather than replaced.

**Build:** add a bounded incident analysis-status read model: waiting/current/stale/paused/failed, last successful analysis and meaningful reason. Preserve useful prior results with a stale label while reanalysis runs. Refresh through existing scoped realtime infrastructure or modest polling only while the panel is open. Give administrators a safe route to diagnostics/replay; avoid exposing raw queue payloads or implementation ids to responders. Keep intelligence informational for readiness.

**Acceptance:** cold start, edit/reopen, policy change, provider outage, paused lane, poison job and recovery show correct states; no misleading empty result; no cross-scope leak; keyboard and screen-reader state announcements are concise; 390 px layout and request-count budgets pass.

**Touchpoints:** incident Intelligence cards/empty state, actor-scoped views, fingerprint/finding generations, queue/backpressure status and existing realtime infrastructure.

**Dependencies / effort:** can start after status semantics are agreed; approximately 3–5 days.

## P1-07 — Expand answer evaluation, feedback and controlled rollout

**Finding: observed coverage gap.** Live-model evaluation has six synthetic cases. Grading checks nonempty output, visible tool-progress labels, some citations and refusal patterns. It does not comprehensively evaluate correct tool arguments, unsupported claims, current action preconditions or recovery. Existing feedback subjects cover findings/correlation/relationships, not assistant answers. OTel spans, usage charts and budgets already exist; the missing piece is a safe answer-level quality/rollout loop.

**Build:** define a reviewed scenario set (proposed initial target: 100 cases, not an existing result) spanning authorization, classification, contradictory evidence, empty/old data, fallback, cancellation, actions and multilingual/long-history input. Add structured assertions over tool arguments/results and evidence handles. Add opt-in answer feedback with minimal reason codes and private diagnostic identifiers; capture no raw prompts in general telemetry. Compare prompt/model/provider versions on a frozen set and a staged service cohort. Report usefulness, grounding failures, refusal correctness, latency and token cost separately.

**Acceptance:** every authorization, disallowed-egress and unconfirmed-write case is a hard failure. Repeat live evaluations with explicit paid-call opt-in and spend caps. Separate deterministic CI results from live-model results and human usefulness ratings. Regression reports show baseline/candidate differences. Rollback of model/prompt selection is explicit and audited.

**Touchpoints:** `tests/evals/squire`, prompts/guidance, AI usage and spans, feedback contract/storage and settings UI.

**Dependencies / effort:** begin fixtures alongside P0; grounding/action assertions depend on their contracts; approximately 6–10 days, excluding ongoing human labeling and provider access.

## P2-08 — Add a practical quality-review and onboarding workflow

**Finding: extension of existing gates.** Quality metrics, evaluation, service policies and audited weight publication already exist. The opportunity is helping an operator gather representative labels and understand why a service is not ready. Service selection on the quality page currently takes the first 100 readable services.

**Build:** an onboarding checklist for source coverage, data boundaries, provider readiness and baseline replay; searchable/paginated service selection; a review queue with representative positives, negatives, critical examples and topology cases; reasoned corrections and reviewer provenance. Use time- and service-aware held-out evaluation rather than relying only on every fifth pair as a split. Add data freshness and drift review. Explain each existing AUTO requirement and next step; never manufacture labels or lower thresholds to make a service appear ready.

**Acceptance:** a large service fleet can find and review any authorized service; labels retain provenance; independent test data cannot enter training; changed policy/topology invalidates readiness; suggestions require explicit audited adoption; no synthetic fixture certifies production AUTO.

**Touchpoints:** quality/insights/services pages, `evaluation/quality*.ts`, `learning/weights*.ts`, feedback services and replay UI.

**Dependencies / effort:** P1-07 feedback/evaluation; approximately 5–8 days plus real review time.

## P2-09 — Offer safe customer-communication drafts

**Finding: product extension.** Squire can already propose an incident note, including an internal status-update note, and read status pages. Its action catalog has no customer-facing status-page publication action. Internal notes and public status updates must remain distinct.

**Build:** first offer an editable communication draft that opens the native status-page workflow. Include audience, page/components, incident state, text, source evidence and proposed next-update time. Require explicit destination selection and native permissions/approval. A later direct publish proposal must use P0-02's durable intent/outcome contract and an explicit final preview. Reassignment exists; escalation/handoff expansion should similarly reuse native commands and stay outside paging automation.

**Acceptance:** drafting has no external effect; cancellation publishes nothing; stale audience/component state forces re-review; unauthorized users cannot discover recipients or pages; retries cannot duplicate a published update; public output cannot include private incident details by default.

**Touchpoints:** Squire action catalog/proposals and existing status-page draft/publication domain and UI. Discover exact native command boundaries before coding.

**Dependencies / effort:** P0-01/02, P1-05; approximately 5–8 days for draft-to-native-review, with direct publication estimated separately.

## P2-10 — Extend operator diagnostics and recovery

**Finding: extension, not a missing retry system.** Queue health, dead-letter listing and single-item replay already exist. The page shows a bounded list of ten failed items, with limited investigation/filtering.

**Build:** filter/paginate by work kind, service and safe failure category; show retry timing, age and source freshness; link jobs to current policy/provider readiness. Add reviewed bulk-replay previews with eligibility counts, rate limits and cancellation. Quarantine known poison inputs and make recovery semantics explicit. Expose ANN readiness and embedding coverage without leaking vectors or raw provider payloads. Reuse metrics/spans; add alerts and runbooks for sustained degradation, not for every transient retry.

**Acceptance:** bulk recovery cannot overwhelm paging or resurrect OFF-service analysis; role/service scope holds; stale previews are rejected; replay/quarantine are audited; diagnosing a failure does not require SQL or expose secrets.

**Touchpoints:** Intelligence settings, `jobs/work-queue.ts`, runner/backpressure, semantic index capability checks, metrics and operational docs.

**Dependencies / effort:** P1-06 read model; approximately 4–7 days.

## P2-11 — Add opt-in responder handoff briefings

**Finding: product extension.** A weekly Intelligence digest exists. It is not an event-driven briefing for an incoming responder.

**Build:** a private, permission-scoped handoff view covering active incidents, current owners, unresolved questions, recent changes, tried runbooks and pending native approvals. Start with an on-demand preview, then optional schedule-change delivery with deduplication, quiet periods and recipient verification. Evidence links and “as of” time are mandatory. It must not change escalation, create unconfirmed actions or send hidden/private incidents to an on-call recipient who lacks access.

**Acceptance:** schedule rotation/DST, duplicate events, membership changes, revoked access and delivery retries are tested. Notifications remain opt-in and respect existing notification preferences and domain infrastructure.

**Touchpoints:** digest services, on-call reads, Squire briefing tools and existing notification delivery. Exact event integration needs discovery.

**Dependencies / effort:** P1-03/05 and recipient/audience policy; approximately 4–7 days after that policy is agreed.

## Delivery order and review units

1. **Foundation:** reproduce P0-01; harden classification. Define P0-02's lifecycle; implement one recoverable note-action slice with fault injection.
2. **Reliable context:** finish current-action recovery and P1-03 conversation binding. Freeze the shared evidence/message contracts.
3. **Useful answers:** P1-04 retrieval, P1-05 grounding and P1-06 incident freshness. Expand P1-07 evaluations as each slice lands.
4. **Operational adoption:** P2-08 review/onboarding and P2-10 diagnostics. Prove a small operator-led cohort before wider enablement.
5. **Optional workflow expansion:** P2-09 communications drafts and P2-11 handoffs only after foundation and privacy gates pass.

Use small reviewable changes: contract/migration, one vertical behavior, failure cases and UI. Preserve compatibility with old encrypted messages. Keep feature flags default-off where appropriate. Never merge or deploy as an incidental step of implementation.

## Validation and release gates

- Each behavior change: typecheck, zero-warning changed-source lint, targeted unit/integration tests and relevant production browser coverage. Keep existing full pre-push/CI gates.
- P0 privacy: fake-provider payload inspection with synthetic canaries, plus independent security review before broad rollout.
- Actions: crash/concurrency tests at every reservation/commit/response boundary; no unsafe automatic replay.
- Retrieval: authorization-before-effective-top-k, older-than-500 recall fixtures, optional-pgvector parity and dedicated performance evidence.
- UI: keyboard, screen reader, axe and narrow-screen checks for context switches, stale data, expired cards and uncertain outcomes.
- Existing release work remains distinct: live-provider evaluation, representative human quality labels, dedicated-hardware load isolation, fault/rollback drills and live notification/provider checks. CI success and synthetic data do not replace these gates.

## Product decisions to settle during implementation

- For Personal history with only Internal providers, omit the disallowed context or fall back entirely to basic mode? Recommendation: conservative fallback with a clear explanation until typed context classification is complete.
- Should an old incident conversation follow the page automatically? Recommendation: no; show the active conversation context and require an explicit switch.
- Which unknown actions may be resumed? Recommendation: none until their domain command has a proven idempotency/reconciliation contract.
- Should Squire publish customer communications directly? Recommendation: ship native-review drafts first; defer direct publishing.
- Which deployment has representative labeled incidents and permission to run paid evaluations? This is a release-input dependency, not an implementation assumption.

## Deliberately deferred

Autonomous remediation, pre-paging suppression/holds, automatic adoption of learned rules, unrestricted external knowledge ingestion, fine-tuning and a replacement agent/queue framework. None is required to deliver the foundation improvements above; each would need its own safety and product case.
