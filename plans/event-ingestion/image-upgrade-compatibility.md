# Image upgrade compatibility

Replacing the image must preserve the existing synchronous ingestion behavior. Async ingestion is a separate, explicit rollout.

## Default image replacement

Leave `OPSKNIGHT_INGESTION_MODE` unset, or set it to `sync`. Existing deployments need no Kafka, Redis, ingestion workers or new ingestion settings.

The image's existing startup entrypoint runs additive database migrations before serving requests. The ingestion migrations create new tables and indexes; they do not rename, delete or rewrite existing incident, integration, alert, Automation or background-job tables. For split deployments, update the migration owner's image as well as application images. Replicas configured to skip migrations wait for the migration owner through the existing readiness gate.

Default-mode compatibility:

- Events API trigger/acknowledge/resolve requests retain the synchronous `202` result containing the incident, after incident processing commits.
- Routing keys, existing service settings, incident IDs, frozen SLA targets, alerts, pending jobs and Automation configuration remain intact.
- The asynchronous 256 KiB envelope limit does not apply to synchronous requests. Existing request-size and stored-alert truncation rules remain in effect.
- `Idempotency-Key` keeps its previous ignored behavior in synchronous mode, including values longer than the new asynchronous header limit.
- Queue-specific event timestamps and recovery lookback behavior apply only to ingestion-worker processing. Synchronous processing preserves its existing timestamp semantics.
- Default startup and shutdown do not start an ingestion consumer or publish a synthetic ingestion-worker heartbeat.

## Explicit async rollout

Apply migrations and finish upgrading producers before setting `OPSKNIGHT_INGESTION_MODE=postgres` consistently on the web tier and ingestion workers. Integrated installs can run their consumer in-process. Split installs need the dedicated ingestion-worker role.

In this mode, `202` means durably accepted, and the result contains a receipt ID instead of a materialized incident. Clients depending on an immediate incident result must stay in synchronous mode or be updated to use receipt status before the operator enables async mode. Enabling this mode is deliberately not a silent consequence of changing an image tag.

Do not mix synchronous and asynchronous producers for the same routing identity while a backlog exists. For rollback, pause admission, finish in-flight admissions, drain/reconcile accepted work with consumers still enabled, then return producers to `sync`. Keep the additive tables and receipt history. Reverting an image alone must not strand a previously enabled async backlog.

## Executed checks

The populated upgrade harness ran against both the published `v2.0.0` baseline (`f81dfc25520a6c45007f87d90ac470547effbd6c`) and the original ingestion branch base (`58e9271cc7599447f86ecabae4592634d969cb30`).

For each baseline it generated the old Prisma client, applied the baseline migrations to an empty isolated database, seeded existing records, and ran the actual candidate image migration/index/backfill entrypoint. It checked preservation of administrator credentials, routing keys, service settings, incident/SLA fields, alerts and pending background jobs. Existing Automation configuration was also checked where that feature existed in the baseline.

After migration, it exercised the current Events API using an existing routing key, including a 300 KB custom payload and a long previously ignored idempotency header. It verified trigger, acknowledge and resolve results, zero implicit inbox receipts, old-client reads and writes, the split-runtime readiness gate and an idempotent second startup.

Evidence is in `upgrade-f81dfc25.json` and `upgrade-58e9271c.json`. These checks use the actual startup script and application handlers, but do not certify replacement of a running Docker image, old/new notification worker interoperability, an HA rolling deployment, or enterprise capacity. Those remain separate certification gates.

## Reproduce safely

Create a new, empty localhost database whose name starts with `ingestion_test`. Set `DATABASE_URL` to that database and leave ingestion mode unset. The harness refuses populated databases and never resets data.

```sh
npm run certify:ingestion:upgrade
```

The default baseline is the original ingestion branch base. To check the published release, use another fresh isolated database:

```sh
INGESTION_UPGRADE_BASELINE=f81dfc25520a6c45007f87d90ac470547effbd6c npm run certify:ingestion:upgrade
```

No PR should be opened until the complete architecture and its certification gates are finished.
