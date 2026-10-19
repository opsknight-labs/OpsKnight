# Namespace-scoped REST v2 certification

Push the application before deploying it. Use a dedicated namespace named
`opsknight-api-<PR>-<short-revision>` in `kind-opsknight-cluster`; label it with
`opsknight.com/owner=codex` and `opsknight.com/source-revision=<full application SHA>`.
Build the production Dockerfile from that commit and record the image ID, source
label, architecture and build command. On a constrained shared VM, the build-time
heap can be selected with `--build-arg BUILD_NODE_MAX_OLD_SPACE_SIZE=2048`; resource
limits for BuildKit containers must also leave headroom for the cluster.

The SDK runner expects the chart release/full name `api-cert`, its split runtime,
services `api-cert-proxy` and `api-cert-postgresql`, and a pre-created
`api-cert-secrets` Secret. Do not put secret values in Helm values or command-line
arguments. Use a database whose name ends in `_test`. The application and all six
worker roles must be ready on `opsknight-pr886:<first nine SHA characters>`.

Run from the repository root after building the generated TypeScript SDK:

```sh
API_SDK_KUBERNETES_NAMESPACE=opsknight-api-886-072b69f \
API_SDK_SOURCE_REVISION=<full application SHA> \
node tests/certification/kubernetes/sdk-kind.mjs
```

The wrapper verifies namespace ownership, source labels and each runtime image,
then starts loopback-only API/database forwards. Signing credentials are read
from the namespaced Secret into memory and child environments. Both SDK workflows
use the deployed application and its real workers. External mode additionally
creates approval-only runbooks through REST and waits for the deployed runbook
worker to materialize their steps, then verifies approval, rejection, reviewed
rerun, exact retries and canonical decision events. It never seeds execution or
step states for this additional journey. This covers native control-plane work;
Docker and Kubernetes Agent execution require separate certification.
The wrapper stops only its own
forwards. Its tests reject unsafe external configuration before any network/DB
access. The default local SDK mode still builds its own web/general-worker pair.

Retain raw SDK output, k6 thresholds and summaries, topology/resources, actual
image IDs, co-resident workload measurements, per-replica revocation/rate-limit
results, database connection pressure, job outcomes and recovery timing. Keep
normal production rate limits enabled. Failed or unfinished runs remain evidence;
never replace them with passing labels. A one-node Kind run measures replica/pod
recovery and local capacity; physical node/database HA and mixed-version upgrades
require their own explicit evidence. This runner does not certify missing APIs or
the real Agent approval/rerun path by itself.

## Native CI image fallback

If the shared local Docker VM cannot complete a production build, dispatch the
existing Docker workflow on the pushed feature branch with
`gh workflow run docker-image.yml --ref <branch> -f certification_archive=true`.
This selects a separate native ARM64 runner, read-only repository permissions,
and the official production Dockerfile. It publishes no registry tags and keeps
the image archive for one day. Standard PR/release checks retain their existing
build path. The manual build has its own concurrency group.

Download `arm64-certification-<full SHA>` from that exact workflow run. Verify
`SHA256SUMS` before `docker load -i application.tar`, then verify the loaded
image ID, ARM64 architecture and OCI revision against `image-metadata.json` and
the requested commit. Load that image into Kind only after those checks pass.
Update the namespace source label, Helm image tag and certification source
revision together. Record the workflow run URL and archive checksum alongside
the deployment evidence. A built image is not a passing runtime certification.
