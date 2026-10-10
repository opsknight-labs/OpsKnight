# Isolated Kind automation certification

These test-only files provision one Kind node inside a Docker VM with 12 CPUs
and 8 GiB of memory. Keep the kubeconfig separate from other Kubernetes contexts.
The fixture credentials are for an isolated, disposable database.

`automation-cluster.yaml` reserves CPU 0 for the system and enables the static
CPU manager. `values-automation-four-web.yaml` gives each of four Web pods one
exclusive core and PostgreSQL four exclusive cores. Three general workers,
two critical workers, and supporting processes share the remaining four cores.
General workers request 333 millicores and can use 1.5 cores each. General
workers claim 25 jobs with concurrency 15. Web connection pools contain 24
connections per pod; each PgBouncer has a 24-connection default pool, eight
reserve connections, and capacity for 1,000 prepared statements. This is capacity-test tuning,
not a change to production defaults or the certification gates.

The Kind values select `pgbouncer.prismaCompatibilityMode: false` for the
verified PgBouncer 1.26.0 image. This preserves Prisma's prepared-statement
cache in transaction pooling mode. Legacy compatibility remains available
through the Helm setting; native mode requires positive
`pgbouncer.maxPreparedStatements`. See the [Prisma pooling guidance](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer).

Load the exact revision's application image and the local PgBouncer image into
`opsknight-automation`, then install the existing Helm chart in namespace
`automation-cert` with these values. Override `image.tag` with the image under
test. Record its revision label and digest with the results.

Before applying test environment variables, patch the Web, general-worker and
critical-worker Deployments to `maxSurge: 0` and `maxUnavailable: 1`. This allows
rollouts when there are too few unallocated exclusive cores for a surge pod.
Set these variables on the test Deployments with `kubectl set env`:

- `OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS=host.docker.internal,127.0.0.1`
- `INTEGRATION_RATE_LIMIT=false`
- `PROMETHEUS_SCRAPE_TOKEN=automation-local-cert-metrics-token`

After installing Helm, patch the test PostgreSQL StatefulSet container arguments
to `-c max_connections=300 -c shared_buffers=512MB`, and wait for its rollout.
PostgreSQL has a 2 GiB memory reservation. This patch changes only the disposable
test database; the chart retains its production defaults.

Install metrics-server before starting the OFF baseline. The recorded local
setup uses metrics-server v0.8.0 with `--kubelet-insecure-tls` for Kind's kubelet
certificate, a zero CPU request, and a 128 MiB memory request. Wait for its API
and all application rollouts to become available.

Web uses NodePort 30080, exposed as `http://127.0.0.1:3439`; this endpoint survives
the Web pod deletion drill. Forward only PostgreSQL for the host-side seed and
certification helpers. Run `tests/load/helpers/seed.ts --scale medium`, then
`tests/load/helpers/automation-certify.ts`, with the namespace, seed manifest,
provider emulator endpoints, and isolated database URL configured explicitly.
Use 20 RPS, 120 seconds per profile, the 180-second drain budget,
`AUTOMATION_RECOVERY_DRILL=true`, and persisted provider capacity profile
`provisioned-200`. Reset the exclusively owned provider telemetry once before
the matrix, never between profiles.

Retain raw k6 output, profile telemetry, runtime resource/CPU assignments, and
the final gate result. Record `UNKNOWN` notification attempts separately:
pending-backlog accounting excludes them, and they still require receipt review.
Kind shares the host CPU and memory with other applications; record concurrent
host workloads when interpreting a failed run. Delete only this test namespace
and its database between fresh matrices. These files do not certify capacity by
themselves.

The alternative `values-automation-integrated.yaml` gives four integrated
replicas two exclusive CPUs and 1 GiB each, with two exclusive CPUs and 2 GiB
for PostgreSQL. It uses direct PostgreSQL connections. Patch Deployment
`automation` to the same non-surging strategy, and additionally set
`DATABASE_POOL_SIZE_INTEGRATED=24`, `OPSKNIGHT_WORKER_BATCH_SIZE=100`, and
`OPSKNIGHT_WORKER_CONCURRENCY=15`. Set `AUTOMATION_K8S_RUNTIME_MODE=integrated`
on the certification runner. Its recovery drill deletes one physical integrated
replica, exercising the web and worker roles in that process together. Split
mode deletes one replica of each of the three roles. A missing target or an
unsupported runtime mode fails the drill. Screening diagnostics are separate
from the unchanged six-profile sustained certification.
