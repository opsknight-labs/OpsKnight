# Enterprise event ingestion implementation

Status: implementation in progress; enterprise certification has not passed. Do not open a PR until every required certification gate has evidence. The branch is `feat/enterprise-event-ingestion`, based on `origin/main` at `58e9271cc`.

## Implemented boundary

Provider parsers and authentication remain in their existing routes. `processIntegrationEvent` is the shared admission boundary. `OPSKNIGHT_INGESTION_MODE=sync` preserves the synchronous API by default. `postgres` acknowledges only a committed inbox append and returns a receipt ID. An accepted receipt is not proof of a successfully materialized incident.

The ingestion module owns envelope validation, delivery identity, capacity reservations, quota leases, processing leases, retries, operator commands, status and retention. Workers call the existing incident engine. Incident mutation, Service Automation decisions, notification/runbook outbox records, receipt completion and capacity release commit in one transaction. The receipt row lock and lease token fence stale workers. There is no claim of exactly-once external notification delivery.

Admission takes a per-key transaction lock before assigning the monotonically increasing receipt sequence. Consumers claim only the oldest unfinished receipt for a service/integration/deduplication identity. Independent keys can run concurrently. An exhausted or malformed head goes to `DEAD` and blocks subsequent same-key events until authorized replay succeeds. Raw accepted work is not discarded to unblock a key.

PostgreSQL admission explicitly enables `synchronous_commit` for its transaction. Startup checks require logged inbox storage, `fsync` and `full_page_writes`. Node-loss protection still depends on the deployment's synchronous replication, storage and failover configuration; a single PostgreSQL instance does not provide replica-failure durability.

## Service Automation

Accepted envelopes retain the original provider payload and receipt time. Admission captures the active/candidate immutable Automation version references and mode. Processing evaluates those references through the existing runtime, rather than substituting rules published during queue delay. The global Automation emergency-disable switch is checked live. A configuration disabled at acceptance stays disabled for that event.

Classification, responder snapshot validation, escalation decisions, immutable SLA contracts, observation privacy, Runbook trigger evaluation and outbox generation remain in the existing engine. Mutable service/policy configuration still follows that engine's processing-time reads; the inbox does not claim to freeze every service setting.

Raw alert timestamps and the five-minute resolve-before-trigger lookback use original acceptance time. Backlog delay therefore does not make an old recovery appear newly received. Provider event time is not substituted for gateway receipt time.

## Admission and storage limits

The default unfinished capacity is 100,000 receipts and 1 GiB of serialized envelope data. Sixty-four independently updated budget rows enforce conservative per-shard caps without one global write counter. A busy shard can reject before other shards fill. DEAD receipts keep their reservations. These are logical queue bounds, not a bound on PostgreSQL WAL, indexes, retained receipts, or existing Alert history.

Asynchronous admission reserves small fixed-window quota blocks in PostgreSQL and spends them locally. Unused reservations are stranded until expiry when a replica exits or cache entries are evicted. This deliberately under-admits rather than overshooting the shared quota. Allocation uses the database clock; local validity uses a conservative monotonic deadline. This is not the proposed Redis/GCRA implementation and does not provide separate sustained/burst policies.

Completed raw inbox payloads expire after 24 hours by default, in bounded, audited maintenance batches. Pending/processing/dead-letter payloads are retained. Receipt IDs, content hashes, results and delivery-idempotency tombstones remain. Existing Alert and audit retention policies are independent. Receipt-history partitioning and eventual tombstone lifecycle remain required capacity work.

Envelopes are capped at 256 KiB without silent truncation. This is a new limit for opt-in asynchronous processing; synchronous behavior retains its existing request limits. Delivery IDs identify requests, and a stable ordinal identifies each event produced by a multi-alert request. Providers without a delivery ID or explicit `Idempotency-Key` retain logical incident deduplication, but HTTP resubmission can create additional raw alert receipts.

## Operator interfaces

`GET /api/admin/ingestion` returns persistent queue counts, oldest unfinished age, budget usage, recent worker evidence and up to 100 dead-letter summaries. `receiptId` selects an individual receipt. The System Health page reuses this API and the existing Card, Badge and Button components.

`POST /api/admin/ingestion` supports strict `pause`, `resume`, and `replay` commands. Every mutation requires `admin.manage` and commits its audit entry in the same transaction. Pause stops new admission while workers drain. Replay only transitions DEAD receipts and preserves their stored envelope and sequence. No discard or arbitrary payload-edit operation is exposed.

`GET /api/events/receipts/{id}` accepts a live API key and applies the same event capability and service/team scope policy as the Events API. It returns no raw envelope or lease credentials. Routing-key-only clients can use an authorized administrator or scoped API key for inspection.

Prometheus counters separate new accepted receipts from duplicate submissions and processing outcomes. Histograms separately record durable append latency and acceptance-to-processing completion latency. Instance counters reset on restart; the receipt ledger remains authoritative for reconciliation.

## Running the candidate

Generate the Prisma client, apply migrations, then enable the mode consistently on producers and ingestion consumers. Integrated deployments run a consumer in the integrated process. Split deployments use `OPSKNIGHT_PROCESS_ROLE=ingestion-worker` with an independent `DATABASE_POOL_SIZE_INGESTION_WORKER` budget (default pool 10 unless explicitly configured; the Compose overlay sets 5 for concurrency 4).

Compose opt-in configuration:

```sh
OPSKNIGHT_IMAGE=<image-built-from-this-branch> docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.ingestion.yml config --quiet
```

The overlay extends the existing worker service rather than duplicating its credentials, networking and healthcheck configuration. It has not been deployed as an HA topology by this change.

Environment settings:

- `OPSKNIGHT_INGESTION_MODE`: `sync` (default) or `postgres`.
- `OPSKNIGHT_INGESTION_CONCURRENCY`: 1–32, default 4 per worker process.
- `OPSKNIGHT_INGESTION_POLL_MS`: 50–30,000, default 250, with jitter. Database failures use bounded exponential backoff.
- `OPSKNIGHT_INGESTION_MAX_PENDING`: 64–10,000,000, default 100,000, divided conservatively across 64 shards.
- `OPSKNIGHT_INGESTION_MAX_PENDING_BYTES`: default 1,073,741,824, divided across the same shards.
- `OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE`: default 120 per Events API admission key.
- `OPSKNIGHT_INGESTION_INTEGRATION_PER_MINUTE`: default 100 per provider integration.
- `OPSKNIGHT_INGESTION_PAYLOAD_RETENTION_HOURS`: 1–720, default 24, for completed inbox payloads.

Quotas are not throughput guarantees. Configure them from measured deployment capacity. The corrected Events API key selection no longer puts every API key into the shared literal `integration:api-key:events` quota bucket.

## Rollout and rollback

Do not mix synchronous and asynchronous producers for the same routing identity while an accepted backlog exists: a synchronous lifecycle transition can overtake queued work. For rollback, pause admission, wait for in-flight admissions to finish, keep ingestion workers in `postgres` mode, reconcile and drain all receipts, then switch producers to `sync`. Resolve DEAD receipts first. Stop consumers only after the backlog is empty. Keep both additive migrations and all receipts; do not drop inbox tables to roll back application behavior.

A worker may be replaced without draining first: its uncommitted transaction rolls back and a replacement can recover the lease. Default leases last 60 seconds; recovery is safe but not a two-second latency guarantee after a crash.

## Remaining plan gates

- Phase 0: representative HTTP baseline and query/lock/WAL instrumentation; the committed library microbenchmark is only an initial diagnostic.
- Phase 1: evidence-backed transaction/query optimization and immutable configuration cache tuning beyond the existing version cache. Sustained/burst admission and service/tenant quota management remain incomplete.
- Phase 2: PostgreSQL inbox correctness is implemented and locally exercised. Live HTTP/browser/outage and rolling-upgrade certification remains incomplete.
- Phase 3: Kafka/Redpanda transport, broker acknowledgement/offset contracts, rebalance/failover testing and broker-backed database-outage acceptance are not implemented. Configuration rejects unsupported transports.
- Phase 4: weighted tenant fairness, reserved critical ingestion capacity, adaptive processing concurrency, history partitioning, archival and deployment query-plan evidence remain incomplete. Existing downstream worker lanes remain separate.
- Phase 5: Swarm and Kubernetes sustained 1k/5k/10k HTTP RPS, a 25k burst and drain, provider failures, replica failover, rolling upgrades, restoration and the 24-hour soak require dedicated execution and reconciliation. None is claimed as certified.

Do not interpret faster durable acceptance as sustainable incident-processing capacity. The measured local completion rate is far below the enterprise target.
