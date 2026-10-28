# Intelligence engine: certification status

**Status: NOT CERTIFIED.** This is an honest ledger of what has evidence behind it and what still needs a
gate. Nothing here authorises automatic grouping or any delay before paging; both are unimplemented and
cannot be selected.

## What the current build does (recommendations only)

Similar incidents, reversible shadow/suggest correlation, possible causes, runbook suggestions, insights,
the AI gateway and the read-only Squire assistant. Every feature is off by default and is configured in the UI.
See `docs/architecture/intelligence.md`.

## Evidence that exists

| Claim | Evidence |
|---|---|
| Paging path is not modified | `tests/architecture/intelligence-boundaries.test.ts` forbids edits to `events.ts`, `incidents/creation.ts`, the outbox and the job queue; nothing is written at incident creation |
| No incident/alert/note history is rewritten by intelligence | the same architecture test scans intelligence code for writes |
| No suggestion reveals an incident, change or runbook the viewer cannot read | `similar-view`, `response`, `squire`, `api-v2-intelligence` integration tests use genuinely scoped `USER` actors |
| Correlation is reversible and idempotent | `correlation`, `correlation-commands` integration tests (append-only events, concurrent group creation, link/unlink) |
| Worker faults are contained | `runner`, `work-queue` integration tests (lease expiry, poison work to dead letter, per-item timeout, isolation of a failing item) |
| Disabled means inert | `runner` test asserts no queue access while disabled; kill switch forces mode OFF |
| AI egress is SSRF-safe | `ai-security` test (loopback, private, link-local, metadata, IPv6, decimal/hex IPv4, mapped IPv6, plain http, credentials); an architecture test requires every provider constructor to use the guarded fetch |
| A self-hosted model never falls back to an external one without consent | `ai-gateway` integration test and `policy` unit tests |
| Provider keys are encrypted and never returned or audited | `ai-gateway` test; `ai.provider-api-key` registered in the encryption registry |
| The assistant cannot change anything | architecture test (no database writes, no write tools in `squire/`); `ai-security` red-team test where the model asks for write tools |
| Prompt injection cannot widen access | `ai-security` red-team test: a model that obeys planted instructions still receives "no access" for another team's incident; credentials in tool output are redacted |
| Secrets are redacted before egress | `intelligence-ai-gateway-pure` unit tests including adversarial input timing |
| Spans never carry prompts, answers or error messages | `ai-gateway` tracing test |
| Authorization matrix and OpenAPI/SDK are in sync | `api-v2-authorization-matrix`, `api-v2-docs-sync`, `api:clients:check` |

## Gates that are NOT passed

| Gate | State |
|---|---|
| **Ingestion performance** (needed before any inline code) | A/B harness exists (`tests/load/intelligence-ingestion-ab.ts`). Runs on a shared, noisy development host showed no detectable difference (baseline variation 24–45%). **Not certifying evidence**: needs dedicated hardware, repeated alternating runs and confidence-interval comparison. Intelligence is not inline, so this gates AUTO and any hold, not the current build |
| **Shadow quality** (needed before AUTO) | Replay and a rules preview exist. Precision/recall, false-merge rate on a critical-alert suite and calibration curves have not been measured on labelled data. Similarity scores are explicitly marked uncalibrated |
| **Fault tolerance at scale** | Unit/integration coverage only. Not run: DB failover, 10× burst ON vs OFF, rolling restart, clock-skew drills |
| **Rollback drill** | Policy rollback and per-service override clearing are tested; a recorded operational drill is not |
| **Prompt-injection and AI evaluation** | A deterministic red-team test against a scripted model. No evaluation against real models, no labelled answer-quality set |
| **Independent security review** | Not performed |
| **Load of the assistant** | Rate limits and budgets are tested for correctness, not under load |

## Explicit non-goals of this build

- Automatic grouping (AUTO) and any pre-paging hold: unimplemented and unselectable.
- Assistant write actions (even as confirmed proposals): the assistant has no write tools by design.
- Embedding or vector search: no `pgvector` dependency; search is full-text with optional `pg_trgm`.
- Scheduled digest delivery: a last-7-days summary is shown on demand in Settings → Intelligence → Insights.
- MCP exposure: delivered by the native MCP work (PR #924), not this PR.
- Native providers beyond OpenAI, Anthropic, Google and OpenAI-compatible endpoints.

## Before enabling anything beyond SUGGEST

1. Run the ingestion A/B harness on dedicated hardware and record the comparison.
2. Label a historical replay set per service and record precision, recall and false-merge rate.
3. Run the fault-tolerance drills above and record results.
4. Obtain an independent review. Keep every item above attached to the release.
