# Service automation

Automation lives under a service’s Automation tab (also available on mobile). Start with a template, define canonical context, arrange enrichment rules followed by routing rules, and test an alert. Enrichment applies in order; routing takes the first recognized match. Missing or unmapped values never satisfy negative conditions. No matching route uses the service default.

The editor autosaves after 800 ms. Concurrent edits require reviewing the other revision before explicitly saving your copy. Browser recovery copies and downloads preserve unsaved work. Publishing creates an immutable version. Restoring a previous version creates another version with a source reference. Responders with service ownership can edit and test; administrators publish and change operational modes; auditors can read.

Modes:

- DISABLED: existing incident behavior.
- SHADOW: records evaluation, normalization, observations, daily comparison counts and metrics; operational incident fields and paging stay unchanged.
- LIVE: final priority is applied before SLA calculation; tags, responder route, and supplemental Slack/Teams actions are committed with the incident.

`NO_ESCALATION` creates the incident and retains ordinary service/integration effects while excluding personal paging and escalation jobs. Supplemental channel actions still run. Decisions are pinned for the incident lifetime, including delayed escalation, recovery, resume, and reopen. Changing the service default policy, automation version, mode, or global switch does not change an existing pinned policy choice. Escalation steps still follow the existing policy-edit semantics. If a formerly pinned policy is deleted after resolution, reopening requires restoring that policy rather than silently switching routes.

Context paths are compiled before publication. Scripts, expressions, prototype traversal, credential paths, non-scalar extraction, and unbounded inputs are rejected. The evaluator has no database/network calls. Discovery records bounded scalar previews rather than payloads. Observation workers cap distinct values at 256 per field/integration and 5,000 per service, and update observations in one bounded bulk statement. Detailed traces and observations default to 90-day retention; decisions remain for the incident lifetime.

## Operator rollout

1. Apply all three additive automation migrations. Deploy the same application image to every web, scheduler and worker role with the global Automation setting disabled. The application treats incidents without decisions as legacy service-default incidents.
2. Verify normal ingestion and notification health. Keep all services DISABLED. Old workers must leave the deployment before any service is enabled LIVE: old workers cannot interpret new decisions.
3. Enable the global switch in Settings → System → Automation. Publish a non-critical service policy and select SHADOW. Draft editing and tests work while the global flag is off.
4. Review seven-day Shadow counts and affected incident traces, unmapped values, fallback reasons and priority/route changes. Test missing fields, new unrecognized values, and provider aliases.
5. Enable LIVE for the reviewed service. Monitor ingestion, critical queue age, personal-notification latency, and automation fallbacks. Expand one service at a time.
6. Emergency stop: disable the global switch in Settings → System → Automation. This stops new evaluations; existing decisions remain pinned. To reverse a policy, restore it as a new published version. Do not change immutable rows or remove reference guards.

Global enablement and trace/observation retention are managed in Settings → System → Automation by administrators. Both are stored in the shared database, with audited changes and optimistic revision checks. No deployment environment variables or restarts are required. New evaluations read the switch directly across replicas. Retention accepts 1–3650 days, defaults to 90, and runs on the general lane. No production environment is enabled by this branch.

## Verification

Run unit tests with `npm run test:unit`. Run real PostgreSQL certification with an isolated `DATABASE_URL` and `npm run test:int -- tests/integration/automation-certification.test.ts tests/integration/automation-load-certification.test.ts --maxWorkers=1`. These tests reset the selected test database. Run desktop/mobile journeys using `DATABASE_URL=... npx playwright test --config playwright.automation.config.ts`, separately from database-resetting tests.

Golden fixtures in `tests/fixtures/automation` are executed by unit tests and the production-backed Test UI. Certification covers duplicate alerts, Shadow/off operational parity, immutable publication and rollback, route pinning across lifecycle changes, corrupt versions, concurrent publication, transaction loss, competing worker claims, expired observation claims, and supplemental idempotency. Existing queue/control-plane tests cover delivery recovery and duplicate intent prevention.

The existing load suite supports `AUTOMATION_LOAD_PROFILE=disabled|shadow-small|live-small|live-medium|live-worst` during `npm run load:seed`. Run `tests/load/scenarios/automation.js` with that seed manifest and profile. It supports `AUTOMATION_RPS` and `AUTOMATION_DURATION`. Existing topology, telemetry, queue-age, provider-latency, and recovery-drill tooling remains the source of capacity certification. The isolated Compose fixture is `tests/load/deploy/compose/automation.yml`; always use project `opsknight-automation-cert`. Set `AUTOMATION_IMAGE` to the image you built. Fake Slack fixtures are disabled by default; `LOAD_SLACK_ENABLED=true` explicitly enables them. Use SMTP/push/webhook emulators for isolated certification.

`spike-results.json` measures the pure evaluator inside a PostgreSQL transaction boundary. `load-results.json` measures complete local incident transactions with eight concurrent clients; it is not an HTTP or production-capacity claim. Release approval requires comparing all profiles on the deployment’s supported topology with the same traffic, including critical queue age and notification latency. Do not infer production capacity from local results.

## Limits and failure behavior

64 context fields; 100 rules; 20 conditions and 8 actions per rule; path depth 12; 2048-byte text and 256-byte enum inputs; 200 aliases per field; 256 compiled versions per process. Ordinary evaluation targets p50 under 1 ms, p95 under 3 ms, p99 under 8 ms; the runtime stops evaluation at 15 ms. Oversized, corrupt, missing, or invalid inputs discard all automation outputs and pin service-default routing. Database failures roll back and retry through the existing transaction layer. Supplemental transport failures retry independently without changing the route.

Metrics are `opsknight_automation_evaluations_total`, `fallback_total`, `shadow_difference_total`, `unmapped_total`, `evaluation_duration_ms`, and `extraction_duration_ms`, with the shared automation prefix. Labels are low-cardinality mode/outcome/reason/type; service, incident, rule, and version IDs are never metric labels. Existing structured logs and audit events record actor, service, version transitions, mode transitions, and lint state without webhook payloads.

Run all five HTTP profiles against an explicitly isolated, seeded deployment:

```sh
OPSKNIGHT_LOAD_CERT_DB=true AUTOMATION_TOPOLOGY=compose-split \
  AUTOMATION_RPS=2 AUTOMATION_DURATION=20s AUTOMATION_RECOVERY_DRILL=true \
  npx ts-node -r tsconfig-paths/register --project tsconfig.script.json \
  tests/load/helpers/automation-certify.ts
```

Supply `DATABASE_URL`, `BASE_URL`, `LOAD_SEED_MANIFEST`, and `LOAD_EMULATOR_CONTROL_URL` for that deployment. For Kubernetes, also set an isolated `KUBECONFIG` and `AUTOMATION_K8S_NAMESPACE`; the fault drill deletes one web, critical-worker, and general-worker pod. Integrated Compose restarts one integrated replica. Results go to `artifacts/load-certification/automation/<topology>/certification.json`. The runner checks accepted-event parity and duplicate incidents, and collects latency percentiles, trace volume, queue age, database locks/connections/transactions, provider telemetry, and container resources through the existing load tooling.

See [certification.md](certification.md) for implementation coverage and the limits of the local certification. Production rollout and a sustained Shadow observation window remain operator-controlled.
