# Service automation

Escalation policies support audited Archive and Restore actions on their Dependencies tab. Archiving requires replacing every service default and current published-version reference first, including disabled rules and services. Archived policies disappear from new routing choices; publication and service assignment check their state under a policy-row lock. Historical versions and pinned incident decisions remain intact and continue to protect the policy from deletion. Restoring validates the responder definition before making the policy available again. Apply migration `20261012160000_escalation_policy_archive` before deploying this lifecycle UI.

The lifecycle change passed 14 real PostgreSQL checks, including concurrent archive/default assignment and archive/publication, plus 137 relevant unit checks. These checks do not establish performance certification: the controlled 30-measurement matrix and exact-release browser validation remain outstanding.

Enrichment builds its field lookup once per evaluation instead of allocating and scanning the field list for every action. Run `npx tsx tests/load/automation-enrichment-benchmark.ts` to compare the frozen previous implementation with the current evaluator. The retained Node 22.23.2 measurements show median maximum-size enrichment decreasing from 0.503 ms to 0.076 ms (64 fields, 100 rules, eight actions each); the small case increases from 0.00104 ms to 0.00120 ms. Each sample runs 1,000 whole enrichment evaluations, with alternating implementation order, and checks identical results. This isolated benchmark uses a no-op deadline guard and does not certify ingestion latency or eliminate scheduling-related timeouts. The production evaluation deadline remains 15 ms.

Automation lives under a service’s Automation tab (also available on mobile). Rules start collapsed and support search, enabled-state filtering, and explicit IF/THEN summaries. Context supports bounded discovery from the latest 20 service alerts, frequency-ranked suggested fields, and editable alias rows. Version history is paginated in groups of 20. Start with a template, define canonical context, arrange enrichment rules followed by routing rules, and test an alert. Enrichment applies in order; routing takes the first recognized match. Missing or unmapped values never satisfy negative conditions. No matching route uses the service default.

The editor autosaves after 800 ms. Concurrent edits require reviewing the other revision before explicitly saving your copy. Browser recovery copies and downloads preserve unsaved work. Publishing reviews the latest saved draft and creates an immutable version. Publication and mode changes await any autosave in flight. Recovery copies clear only after confirmed persistence. LIVE requires an impact review of the published version and available seven-day Shadow counts. Restoring a previous version creates another version with a source reference. Responders with service ownership can edit and test; administrators publish and change operational modes; auditors can read.

Modes:

- DISABLED: existing incident behavior.
- SHADOW: records evaluation, normalization, observations, daily comparison counts and metrics; operational incident fields and paging stay unchanged.
- LIVE: final priority is applied before SLA calculation; tags, responder route, and supplemental Slack/Teams actions are committed with the incident.

`NO_ESCALATION` creates the incident and retains ordinary service/integration effects while excluding personal paging and escalation jobs. Supplemental channel actions still run. Decisions are pinned for the incident lifetime, including delayed escalation, recovery, resume, and reopen. Changing the service default policy, automation version, mode, or global switch does not change an existing pinned policy choice. New LIVE decisions snapshot the complete selected policy definition, including step targets, order, delays, channels and conditions. Editing that policy affects new incidents; existing incidents execute their captured definition. Schedule occupants, team membership and recipient availability still resolve dynamically. The snapshot migration captures the definition available at upgrade for older decisions; edits before upgrade cannot be reconstructed. Policies referenced by any published Automation version or incident decision cannot be physically deleted, including after resolution or version deactivation. Their exact identities remain available for reopening historical incidents.

### External Escalation Policy Lifecycle & Snapshot Semantics

- **Rule Selection Freezing**: Publishing an `AutomationVersion` freezes rule routing logic and the selected escalation policy ID (or `NO_ESCALATION` / service default). The Automation version does not duplicate or vendor the escalation policy definition inside the version entity itself.
- **Central Policy Management**: Escalation policy definitions (steps, targets, delays, channels, conditions) remain centrally configured and live. When an operator updates an escalation policy in Escalation Policy settings, those updates immediately govern subsequent incidents that route to that policy.
- **Per-Incident Immutability**: At incident creation time in LIVE mode, `captureResponderSnapshot()` captures a complete, immutable point-in-time snapshot of the selected escalation policy (`responderPolicy` stored in `IncidentAutomationDecision.summary`). This snapshot is strictly bounded (`MAX_ESCALATION_STEPS = 50`, `MAX_RESPONDER_SNAPSHOT_BYTES = 65_536`) and validates against `escalationConditionSchema`. Existing incidents execute their frozen snapshot across all subsequent escalation steps, resumes, and reopens.
- **Dynamic Execution Resolution**: While the step sequence, delays, channels, and conditions are frozen per-incident, runtime entity state (current on-call schedule layer occupants, team membership changes, user notification preferences, and contact address availability) resolves dynamically at step execution time via the target resolver.
- **Foreign Key & Deletion Guards**: Any escalation policy referenced by an active/historical `AutomationVersionPolicyRef` or `IncidentAutomationDecision` is protected by database `onDelete: Restrict` and application-level pre-checks against physical deletion.

Context paths are compiled before publication. Scripts, expressions, prototype traversal, credential paths, non-scalar extraction, and unbounded inputs are rejected. The evaluator has no database/network calls. Discovery records bounded scalar previews rather than payloads. Observation workers cap distinct values at 256 per field/integration and 5,000 per service, and update observations in one bounded bulk statement. Detailed traces and observations default to 90-day retention; decisions remain for the incident lifetime.

## Operator rollout

1. Apply all additive automation migrations. Deploy the same application image to every web, scheduler and worker role with the global Automation setting disabled. The application treats incidents without decisions as legacy service-default incidents.
2. Verify normal ingestion and notification health. Keep all services DISABLED. Old workers must leave the deployment before global enablement or SHADOW: old workers cannot interpret automation tasks or decisions.
3. Enable the global switch in Settings → System → Automation. Publish a non-critical service policy and select SHADOW. Draft editing and tests work while the global flag is off.
4. Review seven-day Shadow counts and affected incident traces, unmapped values, fallback reasons and priority/route changes. Test missing fields, new unrecognized values, and provider aliases.
5. Enable LIVE for the reviewed service. Monitor ingestion, critical queue age, personal-notification latency, and automation fallbacks. Expand one service at a time.
6. Emergency stop: disable the global switch in Settings → System → Automation. This stops new evaluations; existing decisions remain pinned. To reverse a policy, restore it as a new published version. Do not change immutable rows or remove reference guards.

Global enablement and trace/observation retention are managed in Settings → System → Automation by administrators. Both are stored in the shared database, with audited changes and optimistic revision checks. No deployment environment variables or restarts are required. New evaluations read the switch directly across replicas. Retention accepts 1–3650 days, defaults to 90, and runs on the general lane. Each transaction deletes at most 1,000 expired traces and 1,000 observations under a ten-second transaction budget. Saturated batches enqueue durable continuation work atomically until the cutoff drains. Raising retention during cleanup protects records under the new retention window. No production environment is enabled by this branch.

## Verification

Run unit tests with `npm run test:unit`. Run real PostgreSQL certification with an isolated `DATABASE_URL` and `npm run test:int -- tests/integration/automation-certification.test.ts tests/integration/automation-load-certification.test.ts --maxWorkers=1`. These tests reset the selected test database. Run desktop/mobile journeys using `DATABASE_URL=... npx playwright test --config playwright.automation.config.ts`, separately from database-resetting tests.

Golden fixtures in `tests/fixtures/automation` are executed by unit tests and the production-backed Test UI. Certification covers duplicate alerts, Shadow/off operational parity, immutable publication and rollback, route pinning across lifecycle changes, corrupt versions, concurrent publication, transaction loss, competing worker claims, expired observation claims, and supplemental idempotency. Existing queue/control-plane tests cover delivery recovery and duplicate intent prevention.

The existing load suite supports `AUTOMATION_LOAD_PROFILE=global-off|service-disabled|shadow-small|live-small|live-medium|live-worst` during `npm run load:seed`. Run `tests/load/scenarios/automation.js` with that seed manifest and profile. It supports `AUTOMATION_RPS` and `AUTOMATION_DURATION`. Existing topology, telemetry, queue-age, provider-latency, and recovery-drill tooling remains the source of capacity certification. The isolated Compose fixture is `tests/load/deploy/compose/automation.yml`; always use project `opsknight-automation-cert`. Set `AUTOMATION_IMAGE` to the image you built. Fake Slack fixtures are disabled by default; `LOAD_SLACK_ENABLED=true` explicitly enables them. Use SMTP/push/webhook emulators for isolated certification.

`spike-results.json` measures the pure evaluator inside a PostgreSQL transaction boundary. `load-results.json` measures complete local incident transactions with eight concurrent clients; it is not an HTTP or production-capacity claim. Release approval requires comparing all profiles on the deployment’s supported topology with the same traffic, including critical queue age and notification latency. Do not infer production capacity from local results.

## Limits and failure behavior

64 context fields; 100 rules; 20 conditions and 8 actions per rule; path depth 12; 2048-byte text and 256-byte enum inputs; 200 aliases per field; 256 compiled versions per process. Ordinary evaluation targets p50 under 1 ms, p95 under 3 ms, p99 under 8 ms; the runtime stops evaluation at 15 ms. Oversized, corrupt, missing, or invalid inputs discard all automation outputs and pin service-default routing. Database failures roll back and retry through the existing transaction layer. Supplemental transport failures retry independently without changing the route.

Metrics are `opsknight_automation_evaluations_total`, `fallback_total`, `shadow_difference_total`, `unmapped_total`, `evaluation_duration_ms`, and `extraction_duration_ms`, with the shared automation prefix. Labels are low-cardinality mode/outcome/reason/type; service, incident, rule, and version IDs are never metric labels. Existing structured logs and audit events record actor, service, version transitions, mode transitions, and lint state without webhook payloads.

Run all six HTTP profiles against an explicitly isolated, seeded deployment:

```sh
OPSKNIGHT_LOAD_CERT_DB=true AUTOMATION_TOPOLOGY=compose-split \
  AUTOMATION_RPS=2 AUTOMATION_DURATION=20s AUTOMATION_RECOVERY_DRILL=true \
  npx ts-node -r tsconfig-paths/register --project tsconfig.script.json \
  tests/load/helpers/automation-certify.ts
```

Supply `DATABASE_URL`, `BASE_URL`, `LOAD_SEED_MANIFEST`, and `LOAD_EMULATOR_CONTROL_URL` for that deployment. For Kubernetes, also set an isolated `KUBECONFIG` and `AUTOMATION_K8S_NAMESPACE`; the fault drill deletes one web, critical-worker, and general-worker pod. Integrated Compose restarts one integrated replica. Results go to `artifacts/load-certification/automation/<topology>/certification.json`. The runner checks accepted-event parity and duplicate incidents, and collects latency percentiles, trace volume, queue age, database locks/connections/transactions, provider telemetry, and container resources through the existing load tooling.

Provider duplicate counters must remain available and monotonic throughout a run; missing or reset telemetry fails certification. `AUTOMATION_PROVIDER_CAPACITY_PROFILE=provisioned-200` provisions persisted UI capacity settings for the fixture's `smtp` email provider, `web-push` push provider and default webhook provider at 200 messages/second and 40 concurrent deliveries each. The default profile leaves configured provider budgets unchanged. These infrastructure provisioning profiles do not change certification thresholds. The interactive scenarios use supported incident urgency updates and lifecycle actions.

Use a fresh, exclusively owned provider emulator for each freshly seeded database. Alternatively, `AUTOMATION_RESET_PROVIDER_TELEMETRY=true` resets that emulator once before the first profile. Fixture IDs and durable delivery IDs can repeat across separate fresh databases; retaining previous-run identities would count those new-run deliveries as duplicates. Counters are never reset between profiles or while traffic is running. The emulator reports up to 20 duplicate identities for diagnosis.

See [certification.md](certification.md) for implementation coverage and the limits of the local certification. Production rollout and a sustained Shadow observation window remain operator-controlled.

Global OFF resets all service modes to DISABLED. Drafts and published versions remain available. After re-enabling, stage each service through SHADOW and review LIVE separately. All old workers must leave before global enablement: SHADOW already emits automation tasks that old workers cannot process.

The comparative runner applies the database global switch separately for `global-off` and `service-disabled`; the legacy `disabled` fixture is an alias for service-disabled. It refuses a pre-existing backlog (including delayed retries, except terminal incident escalation/unsnooze timers and future periodic compliance sweeps) and stops after an undrained profile. Use a freshly seeded isolated database when restarting a failed comparison. For web connection pooling, add `-f tests/load/deploy/compose/automation.pgbouncer.yml` and set `AUTOMATION_PGBOUNCER_IMAGE` to a build of `deploy/images/pgbouncer`; workers and migrations use direct PostgreSQL connections.

During the first mixed-version deployment, keep global automation OFF and automation history empty until every scheduler and worker has upgraded. Retention is scheduled only when history exists, so a never-enabled deployment emits no automation tasks. Once automation has been used, switching OFF does not cancel durable work or retention; downgrading workers requires draining automation work first. Old binaries cannot safely process automation tasks in SHADOW or LIVE.

**Rollback warning: pre-automation workers are unsafe after activation, even when the global switch is OFF. Retention and existing queued tasks continue after OFF. Drain and fence automation jobs and use compatible workers before any downgrade; do not blindly roll back worker images.**

Raw recent-alert discovery and samples require `incident.sensitive.read` in addition to service-scoped `automation.read`. Readers without sensitive access receive redacted observation previews and trace details; they can still test samples they provide. Recent-alert replay uses normalized OpsKnight data and clears any unrelated provider sample.

Dedicated maintenance metrics expose `opsknight_automation_observation_queue_depth`, `opsknight_automation_observation_oldest_age_seconds`, `opsknight_automation_shadow_rollup_lag_seconds`, `opsknight_automation_retention_pending` and `opsknight_automation_detailed_trace_bytes_total`. Queue snapshots count delayed retries and processing jobs; trace-byte counters update after committed ingestion.

Urgent provider admission reserves at most five tokens per worker allocation, matching the local concurrency cap; bulk lanes retain their configured batching. Quota allocation locks the shared rate-window row before calculating available tokens, so concurrent replicas cannot reserve against stale usage. Provider rate and in-flight limits remain configurable through the UI.

Operational outbox claims for escalation, war-room provider events, incident event side effects, and automation observations recover after 20 seconds without a heartbeat. New claims carry a per-claim UUID; completion, failure, and heartbeat writes are fenced by that identity. The worker renews the whole claimed batch every five seconds, including members waiting to execute. Tokenless legacy claims, bulk jobs, runbooks, and unrelated scheduled work retain the existing ten-minute recovery timeout. New retries clear their previous token before becoming pending. Upgrade every worker before activation; short recovery leases require the batch heartbeat protocol. The event-order lookup index preserves the existing incident/lane ordering check. See `queue-lookup-certification.json` for its isolated component measurement; it is not an HTTP capacity claim.

Escalation delays apply before a reachable tier runs. If a condition fails or a target has no eligible responders, that tier is skipped and the next tier is tried immediately; skipped tiers do not impose their configured wait. Reordering preserves the configured delay at each position. Selected channels are a strict allow-list intersected with current user preferences; an empty intersection produces no external personal notification (the in-app record remains). Policy mutations serialize on their parent and validate the complete resulting responder snapshot before commit. Snapshot capture reads the policy, all steps, and their conditions in one PostgreSQL statement, so concurrent edits cannot mix definition generations.

Automation context can contain operator-defined customer identifiers. The privacy registry and processing inventory classify this domain explicitly. Standard account export cannot attribute these values through a verified user relation, so the export manifest lists the exclusion and every erasure request requires manual review through the existing unstructured-data review gate. Immutable incident routing evidence is preserved rather than silently rewritten.

Immutable decision and trace explanations are each capped at 256 KiB. Repeated long scalar values use the `STRING_TABLE_V1` representation (`valueTable` and `automationValueRef`); the incident explanation reader decodes both legacy and new records. `omittedValues` explicitly identifies diagnostic values omitted at the storage bound. Routing metadata and the complete bounded responder snapshot are preserved. The `opsknight_automation_decision_bytes` histogram records committed decision sizes.

SHADOW preserves operational routing behavior, but its trace and observation outbox remain in the incident transaction. Atomic diagnostic evidence takes precedence over independent telemetry availability: a diagnostic database write failure rolls back ingestion, and the provider must retry. Failure injection verifies that no partial incident or decision commits and that replay succeeds after the failure is removed. SHADOW does not guarantee isolation from diagnostic database/schema failures.

Central CRITICAL and TRANSACTIONAL notifications use a separate claim heartbeat, renewed every five seconds for active deliveries and waiting batch members. Token-owned heartbeat claims recover after 20 seconds; legacy rows and bulk/public notification claims retain their ten-minute timeout. The original claim timestamp and token fence every settlement and the final pre-dispatch attempt reservation, so a replaced owner cannot send after delayed provider admission. All workers must upgrade before activation. Shared provider quota allocation uses its unique provider/channel/window identity, including rows created under another surrogate ID.

For sustained split-role certification on the isolated 12-CPU Docker host, the optional `tests/load/deploy/compose/automation.cpu-isolation.yml` overlay reserves CPUs 0–2 for Web, 3–5 for PostgreSQL, 6–9 for general workers, and 10–11 for critical/scheduler/pooling work. This is an explicit test infrastructure profile, not a portable default. Integrated-role tests give the application CPUs 0–2 and 6–11 because their workers share the Web process. The 15 ms wall-clock evaluation guard and every capacity gate remain unchanged. Production capacity depends on sufficient CPU reservations as well as provider budgets and connection pools.

Escalation job deduplication has an index matching the exact JSONB logical-key expression and type/status filters. The lookup uses a parameterized SQL value with a fixed literal JSON path, so generic prepared plans can match the expression index. The 10,000-job PostgreSQL regression prepares the exact production SQL and checks present and absent identities under forced generic plans. Prisma JSON-path filters bind the path itself, which prevents that constant-path index match in generic plans. The post-index diagnostic accepted 2,401 events at 20 RPS with no dropped arrivals or HTTP failures; it used an existing database and does not certify capacity. The fresh topology matrix remains outstanding. Failed capacity profiles now preserve acknowledged-event and persisted-incident counts separately, retain their telemetry, and fail the gate on a mismatch instead of throwing away the profile or labeling every mismatch as a lost event.

The incident ingestion path reads the shared global switch, service mode, and active version identity in one uncached PostgreSQL statement. OFF and missing configuration still return the ordinary service-default path; DISABLED does not load the version relation. The shared switch and version pointer therefore come from one MVCC snapshot, and administrator changes remain visible on the next ingestion read.

Policy-name labels in LIVE decisions are taken from the captured responder-policy snapshot, keeping the label and preserved policy definition consistent when a rename commits between the initial routing read and snapshot capture. The database regression injects that independent rename under READ COMMITTED.

LIVE activation validates the service default escalation policy as well as policies referenced by rules. Existing installations with legacy defaults exceeding 50 steps, 65,536 snapshot bytes, or schema validation must repair the default before activation. A LIVE incident whose policy snapshot is absent or invalid fails closed with a pinned-policy integrity error; delayed escalation never substitutes the mutable current policy.

Every notification channel commits an `IN_FLIGHT` delivery attempt atomically with its fenced attempt-budget increment before dispatch. If its worker disappears before recording an outcome, expired-lease recovery marks the parent and attempt `UNKNOWN` for reconciliation. Unsupported webhook/SMTP outcomes require manual receipt review and are not automatically replayed. A late accepted response from the original fenced owner can settle that same attempt. The isolated recovery regression covers both inline and queue dispatch, failure to persist the dispatch marker, and late acceptance.

The three sustained six-profile runs of frozen head `37424d6ca5` are retained in `persistence-capacity-results.json`. None passed the unchanged 20-RPS gates. The four-Web split run exposed two accepted webhook deliveries replayed after a worker restart; the provider receipt timestamps are preserved in `abandoned-dispatch-evidence.json`, and that evidence prompted the durable dispatch-marker fix. Passing correctness tests does not certify production capacity. A clean run of the final source and image is still required.

Recovery also treats unfinished voice `ACCEPTED`/`RINGING`/connection progress receipts as dispatched attempts, so a progress callback arriving before a worker crash cannot permit replay. Signed voice callbacks may advance an unfinished `UNKNOWN` attempt; completed attempts remain immutable. PostgreSQL regressions cover abandoned progress receipts through both claim paths.

The isolated Kind capacity attempts are also retained in `persistence-capacity-results.json`. The first matrix completed five profiles and aborted during worst-case cleanup after a transaction timeout; concurrent host test processes were observed during that last profile. The four-Web matrix was stopped after four completed profiles because its disabled/SHADOW latency, SHADOW arrival-drop, and fallback gates had already failed. Its restart profile accepted and persisted all 2,401 alerts with zero duplicate provider deliveries and no `UNKNOWN` attempts remaining at cancellation. Neither attempt certifies capacity. The reproducible test topology and database/pool tuning are documented under `tests/load/deploy/kubernetes/kind`.

The larger-pool/four-core PostgreSQL Kind attempt was stopped after three complete profiles when disabled latency and SHADOW drops/fallbacks failed their gates. Helm now exposes `pgbouncer.prismaCompatibilityMode`: the existing legacy mode remains the default, while the Kind fixture explicitly selects native prepared statements on verified PgBouncer 1.26.0. Native mode rejects disabled prepared-statement tracking. `native-pgbouncer-evidence.json` records a real eight-client/two-server connection smoke test, including transaction rollbacks and correctly isolated prepared-statement results. This smoke test establishes protocol correctness, not sustained capacity; a fresh image/matrix is still required for that.

The native prepared-statement Kind matrix failed its sustained OFF baseline:
2,048 events were accepted and persisted, 353 scheduled arrivals were dropped,
and the queue drained in 102.8 seconds with no duplicate provider deliveries.
This result does not certify native-mode capacity. The retained integrated Kind
fixture and explicit recovery topology support a separate fresh allocation test;
short diagnostics do not establish sustained capacity.

The integrated Kind batch-100 matrix completed all six 20-RPS/120-second
profiles. It accepted and persisted every arrival, recorded zero drops,
automation fallbacks, deadlocks or duplicate provider deliveries, and drained
each profile within 180 seconds. It **failed** the 30-second observation queue
age gate (52–77 seconds), so it does not certify capacity. The restart held one
SMTP attempt in `UNKNOWN` for manual receipt review without automatic replay.
The preceding default-capacity and provisioned batch-25 failures are retained
with their actual settings. Operational workers now reserve at most sixteen
claims, and no more than a quarter of their batch, for automation observations;
ordinary jobs retain the remaining batch budget. Claims, heartbeat fencing,
service-batched observation receipts, and concurrency limits remain in effect.
The eight-slot reservation matrix also completed all six profiles with every
arrival accepted and persisted, no drops, duplicate deliveries or deadlocks,
and all queues drained within 180 seconds. It failed latency comparisons,
observation age (up to 48.6 seconds), and eight evaluation-timeout fallbacks
across medium and worst profiles. Capacity remains **not certified**.

The next fixture isolates two API processes, four general workers, and two
critical workers with one guaranteed CPU each, plus two PostgreSQL CPUs.
Observation reservation is capped at sixteen claims while ordinary jobs retain
at least three quarters of the batch. A fresh sustained matrix must verify
this change; total CPU budget and all evaluation and certification gates stay
unchanged.

The first split allocation passed OFF but PostgreSQL was OOM-killed at 2Gi
during service-disabled. It is retained as an incomplete failed run. The
fixture now bounds Web/general pools at 16 connections each and allocates
2.5Gi to PostgreSQL on the same Docker host; this configuration still requires
a fresh complete matrix.

The pool-16/2.5Gi split matrix completed with no database restarts, but failed
latency, dropped arrivals in LIVE-small/worst, and recorded 65 evaluation
timeouts. The next fixture moves two worker CPUs to Web: two Web pods at
two CPUs each, two general pods and two critical pods at one CPU each, plus
two PostgreSQL CPUs. Total allocated CPU stays ten; certification is pending.

The two-CPU Web matrix accepted and persisted all arrivals across all six
profiles with zero drops, duplicate deliveries and deadlocks. Five profiles
passed the comparative gates. LIVE-medium failed with one evaluation timeout,
queue age above 30 seconds, and HTTP latency above 1.25x OFF. Capacity remains
not certified. Oversized explanation encoding now accounts for removed UTF-8
bytes rather than repeatedly serializing the full diagnostic object; a fresh
production-image matrix is required to measure its effect.

A local before/after microbenchmark of 800 distinct 2KB enrichment writes
(12 measured iterations after one warm-up) reduced median oversized explanation
encoding from 623ms to 5.8ms, with identical serialized output. This measures
that encoder path only; it does not establish end-to-end capacity.

The linear-explanation run retained five completed profiles before its runner
ended; worst-case has no result and the matrix is incomplete. All retained
profiles accepted and persisted every arrival without drops and drained within
147 seconds. SHADOW recorded two evaluation timeouts; no capacity pass is
claimed. Normalization now reuses a bounded UTF-8 encoder/scratch buffer, with
Unicode and successive-value regression coverage. A nine-round local benchmark
of 20,000 maximum-size string fields improved median runtime from 94.3ms to
88.7ms; this does not establish end-to-end throughput.

The bounded-normalization matrix completed all six 20-RPS/120-second profiles
with every arrival accepted and persisted, zero drops, evaluation fallbacks,
duplicate deliveries and deadlocks. SHADOW and all LIVE profiles passed their
comparative gates, including restart recovery. Only service-disabled exceeded
1.25x OFF HTTP latency, so capacity is still **not certified**. The same image
and allocation require a fresh complete repeat; no gates are relaxed.

The unchanged bounded-normalization repeat completed all six profiles with
2,401 arrivals accepted/persisted per profile, zero drops, duplicate deliveries,
deadlocks and failed critical notifications; every queue drained. The
service-disabled latency failure did not recur. Instead, LIVE-small and
LIVE-worst failed latency comparisons, and worst-case recorded six evaluation
timeouts. Queue-age gates passed. Consistent capacity remains **not certified**;
API CPU/allocation profiling is the remaining performance investigation.

The operational claim now explicitly excludes `AUTOMATION_OBSERVE` from the
ordinary slice. PostgreSQL regressions cover older observations versus newer
ordinary jobs, concurrent claimers, missing task keys, and tiny/observation-only
batches. The reservation is a capacity boundary even when observations are
older; unused ordinary capacity is not backfilled with observations.

Final certification can use `AUTOMATION_BASELINE_MODE=interleaved`: a fresh
OFF precedes each disabled/SHADOW/LIVE profile, with unique numbered artifacts
and an explicit baseline ID per comparison. Every OFF still passes absolute
gates, all queues drain between runs, and the 1.25x limit remains unchanged.

The rebased fairness build `d5aee5313a7464e8cd9ec82524f68828b2e85a4e` passed
the full Tests workflow (38142189892), service automation validation
(38142166890), and runbook protocol validation (38142167242). It includes
main's Runbook Phase 0 and safe-authoring changes without modifying their
separate worktrees.

Audit 27 completed all ten interleaved 20-RPS/120-second profiles on that build:
24,006 acknowledged events were persisted, with zero dropped arrivals,
fallbacks, incident/provider duplicates, deadlocks, and failed critical
notifications. Every queue drained within 126 seconds. Peak observation queue
age was 2.708 seconds; peak critical queue age during pod replacement was
20.587 seconds. Web, general, and critical replacements recovered successfully.
All five non-OFF profiles nevertheless exceeded at least one 1.25x paired
latency gate, so capacity remains **not certified**. The complete measurements,
explicit baseline IDs, runtime revision/digest, and build-only overrides are
retained in `persistence-capacity-results.json`. The image was built with a
3Gi build heap and Next.js webpack build worker after local Docker VM OOM;
type checking remained enabled and runtime settings were unchanged.

The subsequent review fixes service-default assignment under the same service
advisory lock as LIVE activation. LIVE assignments validate the complete proposed
policy snapshot; DISABLED services retain support for legacy policies. Concurrent
activation and unsafe assignment cannot leave an unsafe LIVE default.

`NO_ESCALATION` suppresses initial automatic responder paging. Explicit later
user/team assignments and lifecycle notifications remain enabled. Database tests
exercise both manual handoff audiences through the actual assignment action and
notification worker, including persisted email intents and in-app delivery.

Raw Server Action inputs are checked against the 256KiB UTF-8 limit before schema
validation. Canonical ENUM values, alias keys and alias targets share the runtime
256-byte UTF-8 boundary. Configuration health groups collapsible warnings while
keeping blocking errors visible and rule-specific warnings on their rule cards.

The capacity runner now retains per-Web-replica histograms for version loading,
extraction, pure evaluation, policy lookup, responder snapshot, decision and trace
persistence, and the complete incident transaction. It subtracts pre-profile
traffic, combines replica counters, and explicitly marks coverage incomplete when
pod replacement, counter resets or scrape failures lose measurements. These
diagnostics do not change the 1.25x latency gate or 15ms evaluation guard. A fresh
capacity certification is still required; Audit 27 remains NOT CERTIFIED.

Review fixes at `0bf145bb061327ade8c22d421b0703d651385de9` passed full Tests
(38151226274), service automation validation (38151212214), and runbook protocol
validation (38151212398). The production image also passed all eight local browser
journeys across desktop, Android, iPhone and tablet. With 100 rules, search took
21–36ms and expansion 62–79ms; the collapsed workspace contained about 700 elements.

Audit 28 completed ten fresh interleaved 20-RPS profiles on that revision:
24,007 acknowledged alerts became 24,007 persisted incidents, with zero dropped
arrivals, fallbacks, incident/provider duplicates, deadlocks, failed critical
notifications or remaining jobs. Pod replacement recovered. SHADOW and LIVE-medium
passed their paired latency gates; disabled-service p99, LIVE-small p95/p99 and
LIVE-worst p99 failed. Capacity remains **NOT CERTIFIED**. All eight component
timing summaries are retained with the results, and raw replica histograms remain
in the referenced artifacts. LIVE-small timings are explicitly partial after Web
pod deletion. The initial policy-read time was included only in whole-transaction
timing in this run; subsequent instrumentation includes it in policy lookup too.

The follow-up persistence change requests only IDs from decision, trace and
observation inserts, avoiding the return and decoding of JSON already available
in memory. Compact traces also avoid constructing unused full rule summaries.
Stored explanations, immutable routing snapshots, byte bounds and trace sampling
remain the same. This change requires fresh capacity measurements; Audit 28
certifies correctness and recovery for the preceding runtime only.

Audit 29 tested revision `347b065e36f9510493e1003db4b0dd075004c17a` with
the persistence projection. All 24,007 acknowledged events persisted and all
queues drained; every paired latency comparison failed at least one frozen
1.25× gate. LIVE-worst also recorded one `EVALUATION_TIMEOUT` fallback.
Capacity remains **NOT CERTIFIED**; this run does not establish zero fallbacks.
The complete matrix and component timings are appended to the capacity ledger,
preserving all preceding evidence.

The next contention fix locks the incident row before an escalation step reads
its claim, generation and cursor, then commits assignment, pages, timeline,
state and next job atomically at READ COMMITTED. It replaces broad Serializable
read conflicts between unrelated incidents with the incident's explicit row
fence. Other escalation transactions retain their existing isolation. Real
PostgreSQL tests cover concurrent ownership, ACK while waiting, rollback after
page writes, and forty incidents sharing a recipient. The previous implementation
failed that shared-recipient test with SQLSTATE 40001; the row-locked commit
passed all four tests with zero retries. Sustained performance must be measured
again before this change supports a capacity claim.

Audit 30 completed the full matrix on exact runtime revision
`4e8c924115e2ca7e8d928f616e6c05a2ad207861`. All three exact-head CI workflows
passed. All 24,008 acknowledged alerts persisted; incident duplicates, provider
duplicates, deadlocks and pending work after each profile drain were zero.
Retries across the measured load/drain windows fell from 45,722 in Audit 29 to
1,179, but every paired ingestion-latency comparison failed at least one 1.25×
gate. SHADOW and LIVE-medium each recorded one `EVALUATION_TIMEOUT` fallback.
Capacity remains **NOT CERTIFIED**; reduced retries do not establish a latency
pass. The full result is appended without changing preceding ledger entries.

Post-run diagnosis sampled one general worker after cleanup: its V8 profile was
99.29% idle. This is not a traffic CPU profile and does not attribute native
Prisma-engine CPU. Earlier high worker CPU samples included cleanup work. Database
snapshots also observed WAL sync/write waits and slow queries; these are leads
for diagnosis, not proof of a storage bottleneck. No latency threshold, evaluator
time limit or provider budget was relaxed.

The next controlled experiment uses `tests/load/helpers/automation-controlled.ts`
instead of carrying one growing database through the matrix. It requires a fresh
seed and the explicitly owned `kind-opsknight-automation` context, namespace
`automation-cert` and database `automation_cert` on local port 55443. It stops
only that fixture's application replicas, captures an immutable PostgreSQL
template, and restores that template before every measurement. PostgreSQL and
application processes restart between measurements, followed by an identical
30-second health settling period. Cold ingestion/version-cache costs remain in
the measured workload; this is not a claim that every ingestion path is prewarmed.

Every profile has OFF–target–OFF brackets, repeated twice: 30 independent
20-RPS/120-second measurements. OFF p95 drift above 15% or p99 drift above 20%
makes the bracket **INCONCLUSIVE**. Stable brackets must satisfy the unchanged
1.25× gate against **both** OFF baselines in every repetition. A geometric mean
is reported for context but cannot hide a failed comparison. Correctness,
fallback and recovery failures still block certification regardless of baseline
stability. Single child measurements explicitly report `MEASUREMENT_ONLY` and
cannot independently certify capacity. This methodology is pending real Kind
validation and does not replace Audit 30 with a passing result.

The unchanged 15ms synchronous evaluation deadline now logs bounded diagnostic
metadata on timeout: EXTRACTION/ENRICHMENT/ROUTING, numeric rule and condition
positions, elapsed milliseconds, field/rule counts and heap usage. It includes
no alert values, rule names or configuration identifiers. Event-loop delay is
not currently measured. These diagnostics identify the check that detected the
timeout; they do not by themselves establish why the process was delayed.

The first Audit 31 attempt stopped after five measurements. Its disabled-service
bracket was **INCONCLUSIVE**, and SHADOW recorded an enrichment-check timeout at
29.06ms. The retained `controlled-certification.json` reports NOT CERTIFIED.
That experimental runner also excluded retry backoff from its latency metric
and inherited a LIVE-small-only recovery drill; its partial results cannot
authorize capacity. All three CI workflows for runtime `2322b9433` completed
successfully, which does not replace the missing capacity evidence.

The hardened runner freezes rate, duration, 1.25× ratio, 30-second queue/paging
limits, 180-second drain budget and provisioned provider capacity. Conflicting
environment overrides are rejected. Fault-free comparison forces recovery off;
`automation-controlled-recovery.ts` runs replica replacement separately and
reports RECOVERY_MEASUREMENT_ONLY. That test covers Web/general/critical replica
replacement, not PostgreSQL recovery or unrestricted production reliability.
Legacy mixed fault/performance runs cannot report a capacity certificate.

Ingestion latency now measures the complete operation including every request
attempt and actual retry sleep. Separate attempt, retry-count and backoff metrics
remain available. Historical final-attempt metrics must not be treated as the
same measurement. A child must exit zero and provide one complete measurement
with complete component telemetry before the parent accepts it. Failed child
termination is retained as incomplete evidence even if an artifact exists.

Each controlled measurement records built-image provenance, ready replica image
IDs/resources, PostgreSQL version, immutable snapshot identity and host-container
utilization. Restoration verifies that prior capacity incidents/decisions/traces
are absent. Provider reset is refused while requests are in flight, then checked
for default behavior and empty delivery state. OS scheduling/cache and concurrent
host workloads are observed, not reset; OFF stability remains mandatory.

Timeout checks now bracket action execution as well as conditions. Diagnostics
include action position, per-phase elapsed time, process CPU delta and prior
observed event-loop delay. CPU includes all process threads; the historical delay
sample cannot measure an ongoing synchronous stall. These are diagnostic context,
not proof of the timeout's cause. The 15ms guard and synchronous decision/trace
persistence remain unchanged. Fresh image, recovery and sustained validation are
still required; capacity remains **NOT CERTIFIED**.
