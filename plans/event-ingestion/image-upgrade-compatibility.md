# Image upgrade compatibility

The candidate defaults to durable PostgreSQL ingestion when `OPSKNIGHT_INGESTION_MODE` is absent. Customers do not need to add that variable, Kafka or Redis. Integrated installations consume in-process; existing split web installations automatically consume one receipt per web replica using the existing Prisma pool. Healthy dedicated ingestion workers suppress that fallback. A missing dedicated service cannot strand accepted work solely because the image was updated.

## Required cutover

The first upgrade from synchronous producers requires draining their in-flight requests before new asynchronous producers receive ingestion traffic. Overlapping old synchronous and new asynchronous replicas can reorder trigger/resolve events. Ordinary mixed-version rolling upgrades are **not certified**. Use a coordinated traffic cutover; additive migrations alone cannot fence code running in old images. Future all-async worker replacements retain receipt lease fencing and replay recovery.

The image startup entrypoint applies additive migrations before serving traffic. Update the migration owner in split deployments; replicas that skip migration wait for its readiness gate. Existing administrator credentials, routing keys, services, incidents, SLA snapshots, Alerts, pending jobs and Automation configuration must remain intact.

## Client contract and rollback

Default `202` means a committed receipt, not a completed incident. The result contains `receiptId`; clients that require an immediate incident must use receipt status or explicitly retain `OPSKNIGHT_INGESTION_MODE=sync` during migration. Idempotency headers now take effect with asynchronous validation. Request quotas remain bounded policy, not an automatic 1,000 RPS entitlement.

For rollback, pause admission, finish in-flight admissions and reconcile/drain receipts while consumers remain asynchronous. Resolve DEAD heads before switching every producer to explicit `sync`. Keep the additive schema and receipt history. Reverting an image must not strand queued work.

## Evidence

Historical `upgrade-f81dfc25.json` and `upgrade-58e9271c.json` tested the earlier synchronous default. They do not certify the current default. The updated guarded harness writes `upgrade-auto-async-<baseline>.json` and checks the populated baseline, migration entrypoint, existing records, receipt-based lifecycle processing through the automatic web consumer, old Prisma client access and repeated startup. It requires a fresh isolated localhost database whose name starts with `ingestion_test` and no mode override:

```sh
npm run certify:ingestion:upgrade
```

The optional published-release baseline is `f81dfc25520a6c45007f87d90ac470547effbd6c`. Source-level populated-database checks do not certify replacement of a running image, mixed-version HA rollout, notification-worker interoperability or enterprise capacity. A native fallback-only Docker run must omit the mode variable and dedicated workers explicitly. Enterprise certification remains false; no PR is authorized until its gates pass.
