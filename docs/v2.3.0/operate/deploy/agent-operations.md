---
title: Install and operate Runbook Agents
description: Enroll, constrain, deploy, monitor, rotate, and recover OpsKnight outbound execution Agents.
type: deployment
product_area: runbooks
audience: [operator, administrator]
keywords: [runbook agent, enrollment, execution policy, scoped secrets, artifact output]
verification:
  level: source
  verified_at: 2026-10-14
  evidence:
    - agent/
    - deploy/compose/docker-compose.agent.yml
    - deploy/kubernetes/helm/opsknight-agent/templates/agent.yaml
    - deploy/kubernetes/kustomize/components/agent/
    - deploy/swarm/docker-stack.agent.yml
---

# Install and operate Runbook Agents

Runbook Agents execute host, container, and Kubernetes actions without accepting inbound connections. Each Agent generates an Ed25519 key pair locally, enrolls with a single-use 15-minute token, signs every request, long-polls for work, renews its lease while running, and keeps unsent results in a durable local spool.

The Agent is separate from the Runbook Worker. The worker plans and reconciles database state; the Agent is the constrained execution plane close to the target.

Local probes have independent meanings. **Startup** accepts initialized local progress; **liveness** verifies that the process and its monotonic progress record remain alive; **readiness** requires safe claiming. Drain, clock skew, unavailable durable storage, lost authentication and a first authenticated heartbeat outage block readiness without forcing a liveness restart. Container health progress lives in `/tmp/opsknight-agent-health.json`, separately from the durable spool. Progress older than 90 seconds fails liveness; Kubernetes permits five minutes for initialization. A locally healthy Agent still requires policy, capability and target permission checks.

Enrollment and transport outages reconnect with bounded exponential backoff and jitter. Authentication rejection stops retries; repair the token or identity instead. Heartbeats never overlap. The Agent blocks initial claims until an authenticated heartbeat succeeds and preserves its private identity and spool across restart. Ambiguous started writes retain UNKNOWN outcomes and require independent target inspection.

## Runbook authoring and operations UI

Advanced JSON edits are not saved implicitly. An unapplied-changes warning remains visible even when switching editor tabs, and draft saving is disabled until the JSON is applied to the builder or discarded with **Refresh JSON from builder**. Step editor identity remains stable during reordering and key edits.

The dedicated browser suite covers publication, service attachment and target selection, trigger configuration, incident suggestions, exact-plan approval, and cancellation. A separate journey covers enrollment, pool membership, scoped secret grants, and rotation. These tests use an isolated database and seed asynchronous worker transitions; they never execute host remediation. Precheck/verification controls reuse the typed step editor; library, execution, and Agent lists provide server-side pagination and filters.

The Runbooks library supports search, published/draft filters, and creation templates. Edit a draft through the ordered step builder and each step's configuration panel; define typed inputs in the Inputs tab. Advanced JSON is an explicit alternative, not the primary editor. Save the draft before publishing: the publish confirmation publishes only the saved version. Published versions remain immutable.

Service automations are independent rules: multiple rules can reuse the same published workflow with different targets, inputs and triggers. **Create rule** guides version/mode, target/inputs, trigger and review; it defaults to paused. **Configure** edits a rule. **Duplicate paused rule** copies configuration into a new identity without copying execution history. **Pause rule** stops future trigger dispatch; existing executions retain their cancellation controls. Manual triggers are explicitly inactive, and dynamic selectors are shown as dynamic targets. Machine-specific write actions cannot target a multi-member `LOCAL_HOSTS` pool; choose a specific Agent instead. Incident executions show ordered step progress and approvals for the exact frozen action and parameters. Cancellation, publication, revocation, and detach operations require confirmation.

**Runbooks → Agents** separates Agents, Pools, and Secrets. Pool membership and scoped secret grants are managed in their configuration panels; secret values remain masked and can be rotated without displaying the existing value. Secret-backed steps require HTTPS between the Agent and control plane. An HTTP polling Agent reports an explicit HTTPS-required error instead of receiving secret material.

**Runbooks → Health** reads durable worker instance/lane evidence from PostgreSQL. HEALTHY requires fresh successful dispatch and reconciliation; missing, stopped or incomplete evidence is UNKNOWN, including when the queue is empty. A scheduler watchdog performs bounded recovery sweeps when worker evidence is missing or degraded; it does not execute physical actions or make uncertain writes repeatable. Prometheus exposes worker health and fresh instance counts, with alert rules in `monitoring/prometheus/opsknight-alerts.yaml`.

## Verified distribution and endpoint

The setup UI reads an official versioned `agent-release-manifest.json`, verifies the installer hash and the server compatibility range, and selects an immutable image digest. The manifest records source revision, protocol/policy schema and architectures. Missing assets, unsupported pairs, invalid endpoints and expired enrollment tokens disable command copying. The v2.0.0 release does not contain the native Agent assets; do not invent its installer URL or assume that its image exists. Release CI validates the published OCI architectures and downloads assets from their final release URLs before considering publication successful.

Confirm the actual HTTPS endpoint reachable from the Agent, independently of the application's public URL. Setup commands run a bounded HTTPS `/api/runbook-agent/v1/time` probe on the Agent host before enrollment. Install the private CA in both curl and Node trust when applicable; never disable certificate verification. Loopback/example hosts, URL credentials/query/fragment and path-prefixed endpoints are rejected by the setup UI. Agent APIs currently require the root path. If the Agent endpoint uses a different hostname from the canonical application URL, configure that exact hostname in `APP_HOST_ALIASES` on every web replica; an unrecognized host is rejected with HTTP 421.

## Safe enrollment sequence

1. In **Runbooks → Agents**, create an Agent and copy its one-time token.
2. Create or review a local `policy.json`. Start with diagnostics only.
3. Persist `/var/lib/opsknight-agent`; it contains the private identity and result spool.
4. Supply the token through a protected file or Secret and start exactly one Agent. Setup commands capture it using a hidden prompt with shell tracing disabled; tokens never appear in copied command arguments. Enrollment expires after 15 minutes. Use **Cancel this enrollment** to revoke an abandoned setup.
   Also pin `OPSKNIGHT_EXECUTION_PUBLIC_KEY` from the trusted **Runbooks → Agents** page. The setup snippets include this value. Agents refuse unsigned or altered execution envelopes.
5. Confirm the Agent becomes `ONLINE`, reports a policy hash, and has spool depth zero.
6. Add it to a `LOCAL_HOSTS` pool for machine-local actions or a `SHARED_TARGET` pool for a common cluster/API target.
7. Grant each referenced secret to only that Agent or pool.

Do not share an identity volume between running replicas. A token is single-use. Create a distinct enrollment for every independent Agent.

Keep bootstrap Secrets while deployment manifests reference them. Once enrolled, the Agent uses its persisted identity and does not read the consumed token again. Removing a still-referenced Kubernetes/Swarm Secret can prevent redeployment. A native environment token can be removed after enrollment; always keep the pinned execution public key.

## Local policy

`BASH` steps require Bash on the native Agent's `PATH`; install it before enabling
that executor. The Agent container includes Bash. Commands run non-interactively
with `bash --noprofile --norc -c`, not POSIX `sh` or a login shell. Bash arrays,
`[[ ... ]]`, and `set -o pipefail` are supported. Profile/rc files and inherited
`BASH_ENV` startup scripts are not loaded; configure dependencies explicitly.

`agent/policy.container.json` is the fail-closed diagnostics-only baseline; `agent/policy.example.json` demonstrates an explicitly allowlisted native service. `allowedStepTypes` enables executors; the Systemd unit, Docker container, Kubernetes namespace, and Bash command lists further constrain targets. A trailing `*` is the only wildcard for resource-name allowlists. Bash commands require an exact match so an allowed prefix cannot append another shell operation. Non-idempotent actions remain disabled unless `allowNonIdempotent` is explicitly enabled.

Platform authorization is a second boundary. Kubernetes RBAC, Docker socket access, Unix permissions, sudoers, or polkit must grant only the operations the local policy allows. A policy entry never grants an operating-system permission by itself.

Validated runbook inputs are exposed to child processes as `OPSKNIGHT_INPUT_<UPPERCASE_KEY>`. Secret-reference inputs are resolved only after a scoped grant check and their values are redacted from previews and uploaded output before leaving the Agent. Avoid printing credentials even with this defense.

Restart the Agent after changing policy. Verify that the policy hash changes in the Agent screen.

### Typed diagnostics and Podman

DNS, TCP and Agent-local HTTP diagnostics use `networkHosts` and `networkPorts`
as exact destination allowlists. Private endpoints are intentionally allowed
only by the local operator; HTTP rejects credentials and redirects. DNS needs
port 53, TCP needs its configured port, and HTTP needs its URL port (80/443 by
default). Configure Kubernetes/Swarm egress separately when required: local
policy does not override network policy. Keep output and time bounds enabled.

Systemd logs and journal diagnostics use a unit allowlist and at most 500 lines.
Docker and Podman share typed container actions but use independent
`dockerContainers` / `podmanContainers` allowlists. The container image includes
both CLIs; an inaccessible runtime is not advertised as effective. Host-native
Agents need the appropriate CLI and narrowly scoped runtime access. For containerized Agents, managing Docker or Podman containers on the host requires providing access to the respective engine:

- **Docker**: Mount the Docker socket (e.g. `/var/run/docker.sock`) into the container when Docker actions are allowlisted.
- **Podman**: Supply a Podman service socket via `CONTAINER_HOST` (e.g. `CONTAINER_HOST=unix:///run/podman/podman.sock` with the socket mounted), or run the Agent as a native host service. Nested rootless Podman execution inside unprivileged locked-down containers (`cap_drop: ALL`, `read_only: true`, `no-new-privileges: true`) is blocked by Linux kernel user namespace restrictions; using an explicit Podman socket connection is the supported deployment approach for containerized agents. Do not expose unauthenticated TCP sockets.

Kubernetes policy includes `kubernetesActions` and `kubernetesMaxReplicas`.
Default actions are read-only and the replica limit is zero. Explicitly add
`scale` and a safe maximum before authoring a scale step; add only the required
namespaced RBAC and API egress. Scale is an idempotent write; rollout restart is
non-idempotent and requires approval. Bounded read-only startup/heartbeat probes
distinguish configured executors from working binaries/runtime connections.
Capability probing does not certify permission for every resource/action.

### Scheduling labels and signing rotation

Administrators manage scheduling labels and pool selectors in **Runbooks →
Agents**. Heartbeats cannot self-grant labels or secret-bearing pool membership.
Pools are the union of explicit and label-matched members; an empty selector
does not match the whole fleet. Use a service binding selector for exact host
placement, and review the snapshotted Agent before approving a write.

In **Pinned execution public key**, stage NEXT and copy the displayed trusted
JSON key map into `OPSKNIGHT_EXECUTION_PUBLIC_KEYS` on every Agent. The map
supersedes the legacy single-key setting and may hold up to eight Ed25519 pins.
Restart Agents to load the map. Activation is blocked until all enrolled
non-revoked Agents, including offline ones, acknowledge NEXT. Keep both keys
through activation; the old identity becomes RETIRING. Wait at least 24 hours
before retiring it and removing its pin. Envelope and lease signatures bind the
key ID, so changing an ID or supplying an unknown key fails verification.

Compose and Swarm forward the JSON environment variable. Helm and Kustomize
read `OPSKNIGHT_EXECUTION_PUBLIC_KEYS` from the existing enrollment Secret;
the legacy single-pin key is optional when using the map. Quote JSON in shell
and env files. Never copy signing private keys: these stay encrypted in the
control-plane database. Back up encryption keys and PostgreSQL together.

## Docker Compose

Run from the repository root. This file starts only the Agent, connecting to an existing installation:

Copy the Compose command from the verified setup UI. It uses both `deploy/compose/docker-compose.agent.yml` and `docker-compose.agent.enrollment-file.yml`, sets `OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH` to a protected file, and pins `OPSKNIGHT_AGENT_IMAGE` to the verified digest. Both the image and `OPSKNIGHT_AGENT_URL` are required. The token file remains required while the Compose Secret references it.

The standalone project has its own network. Internal application service names require an explicitly shared network; use an externally reachable URL by default. Mount the Docker socket only for approved Docker actions. Host Systemd actions should use the native service.

## Helm

Use the separate Agent chart to connect to an existing OpsKnight installation. It deploys only the Agent, local policy, ServiceAccount and persistent identity storage. Create the namespace before the enrollment Secret:

Use the **Helm** command from the verified setup UI. It creates the namespace and the enrollment Secret with `--from-file=OPSKNIGHT_AGENT_ENROLLMENT_TOKEN`, pins `agent.image.repository`/`agent.image.digest`, and sets the confirmed `agent.url`. The standalone chart rejects installation without an explicit image tag or digest. It installs only the Agent; the application Helm chart updates the whole application release.

Pin `agent.image.repository` and `agent.image.digest` to an approved image. The chart requires `agent.url` and grants no Kubernetes API permissions by default. For Kubernetes actions, configure narrow namespaced `agent.rbac.rules`, `agent.kubernetes.enabled` and matching local policy. Apply an environment-specific NetworkPolicy allowing the OpsKnight endpoint and approved targets; the standalone chart does not create one. Preserve the Agent PVC and use a distinct Helm release per Agent. Existing full-stack installations may still use `agent.enabled=true` on the application chart, but that command updates the entire application release.

## Kustomize

The Agent setup UI generates an Agent-only credential-free overlay with the selected URL and image. It includes the Agent Deployment, policy, ServiceAccount/RBAC and PVC; copy its commands from **Runbooks → Agents → Add Agent → Kustomize** and run from the repository root. Create the namespace and external enrollment Secret first. Kubernetes permissions and runtime policy remain diagnostics-only until explicitly configured. Apply an environment-specific egress policy when required.

The existing `profiles/integrated-agent` and `profiles/split-agent` profiles deploy the application stack together with the Agent. Use those only when intentionally deploying or updating the whole stack. Neither profile generates enrollment tokens.

## Docker Swarm

Create an external Raft secret and deploy only the Agent stack. Set `SWARM_NETWORK_NAME` to an existing overlay network:

Use the verified **Swarm** setup command. It creates the external enrollment Secret from a protected file/stdin and requires `OPSKNIGHT_AGENT_NODE_ID`. The Agent is constrained to that node so a local state volume cannot silently become a new identity after rescheduling. Keep the node and its storage available, or explicitly migrate the stopped Agent's durable state before changing placement. A different independent Agent must have a different token and volume.

This starts one Agent with persistent identity storage and does not redeploy the application. Review the policy file referenced by the stack. Keep the external enrollment Secret while the service references it.

## Native Linux service

The installer validates prerequisites for Amazon Linux 2023, Ubuntu 22.04/24.04/26.04, Debian 12/13, RHEL 9/10, Rocky, AlmaLinux, and SLES 15 SP3+ (requires glibc ≥ 2.28; SLES 15 GA-SP2 with glibc 2.26 is unsupported) on both `x86_64` and `arm64/aarch64`. The installer provisions a bundled Node 24 LTS runtime (pinned v24.21.0), eliminating host Node.js and external repository dependencies.

### Standard Layout & File Permissions

| Directory / File                   | Ownership                         | Permissions | Purpose                                                                      |
| :--------------------------------- | :-------------------------------- | :---------- | :--------------------------------------------------------------------------- |
| `/opt/opsknight-agent/`            | `root:root`                       | `0755`      | Standalone binary and bundled Node 24 runtime (`runtime/bin/node`)           |
| `/etc/opsknight-agent/policy.json` | `root:opsknight-agent`            | `0644`      | Local capability allowlist and action policy                                 |
| `/etc/opsknight-agent/agent.env`   | `root:root`                       | `0600`      | Sensitive enrollment tokens, control plane configuration, and execution keys |
| `/var/lib/opsknight-agent/`        | `opsknight-agent:opsknight-agent` | `0700`      | Private identity (`identity.json`), leases, and durable spool                |

### Verified native installation

1. Generate a one-time enrollment token and note the execution signing public key in **Runbooks → Agents → Enroll Agent**.
2. Use **Native Linux** only when the setup UI has verified published artifacts for your server. Its command downloads the verified installer, checks SHA-256 and uses `--token-file`; do not put the token in process arguments or shell history. For an internal build, supply a locally built tarball with its independently verified checksum. An internal build is not a published release certification.
3. Run diagnostic preflight checks (must run as root to inspect `root:root 0600` `agent.env`):

```bash
sudo /opt/opsknight-agent/preflight.sh
```

4.  Enable and start the systemd service:

```bash
sudo systemctl enable --now opsknight-agent
sudo systemctl status opsknight-agent
```

### Transactional Upgrades & Rotation

To upgrade an existing native Agent installation, re-run `install.sh` pointing to the new release or artifact tarball with verified checksum:

```bash
sudo ./deploy/agent/install.sh \
  --url https://opsknight.company.com \
  --tarball /path/to/opsknight-agent-linux-x64.tar.gz \
  --checksum "<SHA256_HASH>"
```

The installer executes transactionally:

1. Validates the new bundle in an isolated staging directory and enforces SHA256 integrity.
2. Drains in-flight executions before restarting an active process.
3. Preserves existing private identity in `/var/lib/opsknight-agent` and local policy in `/etc/opsknight-agent/policy.json`.
4. Atomically replaces `/opt/opsknight-agent` with full backup and automatic rollback on activation failure.
5. Reloads systemd units (`systemctl daemon-reload`).
6. Restarts the active service automatically if it was running. To defer the restart, supply `--no-restart`.

### Host-Native Container & Kubernetes Privileges

Because `opsknight-agent.service` runs unprivileged under `NoNewPrivileges=true` and `ProtectHome=true`:

- **Systemd Executor**: Grant narrow Polkit authorization rules for the unprivileged `opsknight-agent` user (e.g. in `/etc/polkit-1/rules.d/50-opsknight-agent.rules`), rather than sudoers.
- **Docker**: Adding `opsknight-agent` to the host `docker` group (`sudo usermod -aG docker opsknight-agent`) grants root-equivalent control over the host. If your security policy prohibits Docker socket access for non-root services, prefer rootless Podman or narrow Polkit rules.
- **Podman**: Configure rootless Podman socket access or system service connections; do not expose unauthenticated TCP sockets.
- **Kubernetes**: Due to `ProtectHome=true`, store kubeconfig files in `/etc/opsknight-agent/kubeconfig` rather than home directories, and reference it via `KUBECONFIG` in `/etc/opsknight-agent/agent.env`. Narrow RBAC permissions to only allowlisted namespaces.

### Troubleshooting Matrix

| Symptom                                             | Likely Cause                                     | Resolution                                                                                                                     |
| :-------------------------------------------------- | :----------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| `pgrep: command not found`                          | Missing `procps` / `procps-ng`                   | Run installer or install `procps-ng` (RHEL) / `procps` (Debian).                                                               |
| `EACCES /var/lib/opsknight-agent`                   | Incorrect permissions on state directory         | Verify `chown -R opsknight-agent:opsknight-agent /var/lib/opsknight-agent` and `chmod 0700`.                                   |
| `Permission denied reading agent.env`               | Running preflight without root                   | Run `sudo /opt/opsknight-agent/preflight.sh` (`agent.env` is mode `0600 root:root`).                                           |
| `Agent request timestamp is outside allowed window` | Clock drift $>60\text{s}$                        | Synchronize system clock via `chrony` (`chronyc tracking`) or `timedatectl`.                                                   |
| `Unsupported architecture`                          | Host architecture other than `x86_64` or `arm64` | Deploy Agent on supported 64-bit x86 or ARM Graviton architecture.                                                             |
| `Bundled node binary failed to execute`             | Incompatible libc (glibc < 2.28)                 | Deploy on supported OS with glibc ≥ 2.28 (e.g. SLES 15 SP3+, RHEL 9+, AL2023, Ubuntu 22.04+).                                  |
| `Agent offline after reboot`                        | Unpersisted state directory or network delay     | Verify `/var/lib/opsknight-agent` mounts across reboot; systemd unit waits for `network-online.target` and `time-sync.target`. |

## Monitoring and recovery

Set `OPSKNIGHT_RUNBOOK_EXPECTED_WORKERS` to the intended number of independently running Runbook workers (for example `2`). Shared evidence reports healthy versus expected instances; losing one of two workers is degraded even when the survivor continues processing. Without this setting, worker progress can be healthy while redundancy remains explicitly unverified. The scheduler watchdog uses a PostgreSQL advisory lock per recovery sweep. Recovery jobs have a stable execution-specific identity so concurrent sweeps cannot accumulate duplicate pending jobs.

Use **Runbooks → Health** and Prometheus metrics to watch Agent status, active attempts, total spool depth, attempt states, and oldest pending age. Alert on stale heartbeats, non-zero spool depth that continues growing, repeated local-policy denial, and queue age above the execution SLO.

Cancellation is cooperative: OpsKnight marks the request, the lease heartbeat observes it, and the Agent sends `SIGTERM` to the process group followed by `SIGKILL` after five seconds. A timed-out or lost write action can become `UNKNOWN`; verify the external target before retrying.

The Agent maintains a monotonic local lease timer and stops the process group ten seconds before its last known authority expires. Failed renewals never extend that timer. Lease renewal and start acknowledgements are signed, and repeated `/start` calls acknowledge the same lease without extending it. Keep Agent and control-plane clocks synchronized. A durable dispatch marker prevents the same identity from executing a replayed attempt twice.

Results and redacted full output are written and fsynced to the local spool before artifact upload or result submission. They are removed only after a signed server acknowledgement. Terminal rejections move to `spool/dead-letter`; transient network, rate-limit, and server failures remain pending. Review quarantined records locally and monitor `opsknight_runbook_agent_dead_letter_depth`; quarantine preserves evidence and does not automatically repeat remediation.

Automatic retries are restricted to read-only failures. HTTP POST/PATCH, service or container restarts, and Kubernetes rollout restarts require non-idempotent risk classification. A command failure or timeout after a write starts is recorded as `UNKNOWN`, including results from older Agents that report these failures as `FAILED`. Do not start another remediation until you have checked the target's actual state.

The Agent start fence checks the execution deadline, cancellation, and Agent revocation. Lease renewal requests cancellation immediately when the execution deadline passes. A bounded, signed result produced before the deadline can recover an expired lease's unknown outcome when no safe retry has superseded it.

Incident suggestions start the exact version displayed, even after a newer version is published. Before approving a step, review its resolved action, resource, Agent or pool, version checksum, and timeout. Scoped secret values remain hidden. Secret metadata and grants are visible only to users with secret-management permission.

Suggestions also freeze their normalized inputs and Agent/pool target. Binding edits do not change those snapshots. Suggestions created before the snapshot migration must be dismissed and regenerated. Only inputs referenced by the current step's templates or explicit `OPSKNIGHT_INPUT_*` environment names are delivered to its Agent process; unrelated secrets are never resolved for that step.

## Upgrade and capacity verification

Apply the database migrations before updating Web and Runbook Worker replicas. The execution signing private key is generated once and stored encrypted in PostgreSQL; keep the database and encryption-key backups together. Existing Agents must add the pinned public key shown on the Agents page before upgrading. Compose and Swarm use `OPSKNIGHT_EXECUTION_PUBLIC_KEY`; Helm and Kustomize read that key from their existing enrollment Secret. Every independent Agent needs its own identity volume; Helm enforces one replica per identity.

The legacy all-job worker now reconciles Runbooks too. For production workload isolation, continue to use the dedicated Runbook lane: a rejected automatic binding is recorded independently and does not prevent other bindings from starting.

Fault-injection tests cover Agent crash/restart during artifact upload, renewal connectivity loss, exact start retries, trigger isolation, frozen suggestions, and signed payload tampering. These tests establish correctness under those failures; they are not fleet load certification. Before sizing a large fleet, measure idle-Agent and reconnect QPS, concurrent Runbook backlog, paging latency, database connections, and artifact WAL/backup growth. Artifacts remain bounded to 10 MiB compressed per artifact and per attempt, with at most 10 artifacts per attempt in PostgreSQL and retention cleanup; plan storage capacity accordingly.

To replace a compromised Agent, revoke it in the UI, remove its identity volume, create a new enrollment, and review its secret grants. Revocation immediately prevents future signed claims. Output artifacts default to 30-day retention. Administrators can set 1–3650 days under **Runbooks → Agents → Security**, with audit and explicit permanent-deletion acknowledgement. Until an override is saved, `RUNBOOK_ARTIFACT_RETENTION_DAYS` on the scheduler/integrated runtime supplies the fallback. A separate maintenance connection deletes at most 100 rows and 16 MiB per minute, using indexed scans and short statement/lock deadlines. Large backlogs drain gradually without sharing the execution-recovery pool; include one additional connection per scheduler/integrated replica in capacity budgets. Monitor `opsknight_runbook_artifact_purge_rows_total`, `opsknight_runbook_artifact_purge_bytes_total`, `opsknight_runbook_artifact_purge_batches_total` and `opsknight_runbook_artifact_purge_duration_seconds`. Execution history remains.

## Secret transport and host targeting

Signed envelopes provide integrity, not confidentiality. Secret-backed steps require an
HTTPS Agent control-plane URL. The server excludes secret-bearing claims over HTTP before
resolving secrets; non-secret steps may still use the internal HTTP defaults in Compose,
Swarm, Helm and Kustomize. Configure the Agent URL to your trusted HTTPS ingress for secrets.
When TLS terminates at a proxy, enable `TRUST_PROXY_HEADERS=true` only if that proxy overwrites
`X-Forwarded-Proto` and direct access to the backend is blocked. Ambiguous protocol chains
are rejected. A development-only override requires both `NODE_ENV=development` and
`OPSKNIGHT_ALLOW_INSECURE_AGENT_SECRETS=true` on the server and Agent; it is ignored in production.

Machine-specific writes require a specific Agent. `SHARED_TARGET` pools allow any member;
multi-member `LOCAL_HOSTS` pools reject Agent writes until a specific Agent is selected.
Claims recheck this boundary if membership changes after execution creation. Read-only
pool execution may choose any initial member, with local-host retries pinned to that member.

Corrupt spool records are quarantined independently. Dead-letter results keep Agent health
degraded until reviewed. Dispatch markers expire after two days, beyond the maximum execution
and signed lease lifetime, rather than reopening replay immediately after acknowledgement.

## Migration and rollback

Apply migrations before rolling out web, scheduler and worker replicas. The new durable heartbeat/policy-check tables are additive. `ServiceAutomationRule` maps to the existing `ServiceRunbookBinding` table, preserving rule IDs and execution/suggestion foreign keys; the old one-workflow-per-service uniqueness constraint is removed. For the Service Automation observation provenance migration (`20261021040000`), predecessor workers target the previous 4-column unique index; drain and stop `general-worker` replicas before applying the migration to certify zero ON CONFLICT constraint mismatch errors during cutover. Back up PostgreSQL before upgrading. A schema rollback must not recreate that constraint while independent duplicate rules exist. Prefer a forward fix; if reverting application binaries, pause new rules, reconcile active work, and review duplicate-rule behavior before restarting old replicas. Do not delete history or identity volumes as a rollback procedure.

Before promoting a release, exercise fresh install, enroll, one signed read-only action/result artifact, restart identity preservation, drain, upgrade and rollback in the intended topology. CI source/build tests are not certification of every Linux distribution, external TLS proxy, air-gapped registry, Swarm node loss or production capacity. Record PASS/FAIL/NOT_TESTED evidence for each environment.

## Connectivity readiness and policy uncertainty

Liveness remains independent during a control-plane partition. Readiness becomes false after a failed authenticated contact or when the last authenticated heartbeat is 90 seconds old; claims pause until contact recovers. The health file records contact age using a monotonic clock. Identity and uncertain-result spool state remain intact.

Local policy checking does not receive decrypted secrets. A configuration field masked for secrecy produces **DEFERRED**, rather than a definitive policy pass or denial. Exact command allowlists are evaluated again against the actual resolved execution plan at execution time. The server preserves this uncertainty even when an older Agent reports a decision on a masked placeholder.

The scheduler watchdog shares the transaction/connection holding its PostgreSQL advisory lock with reconciliation. It supports a one-connection scheduler pool without acquiring an additional connection during recovery.

## Install another Agent or upgrade an existing identity

Create one enrollment for each independent Agent. The setup UI uses `opsknight-agent-<Agent ID>` for Compose projects, Swarm stacks and Helm releases, and a corresponding Kustomize suffix. Enrollment Secrets, selectors and persistent volumes are isolated. You can install more than one Agent in the same scope without editing generated names. Swarm identities remain pinned to their selected node.

Choose **Install new independent Agent** for a new enrollment. Keep the generated deployment name with its identity volume. Kustomize creates its enrollment Secret directly from the temporary token file, then removes that file. Only credential-free manifests are retained under `${XDG_STATE_HOME:-$HOME/.local/state}/opsknight/agents/<deployment-name>`. Use that overlay for removal and delete the separately created enrollment Secret explicitly. No Secret YAML is saved in the repository.

From **Inspect Agent → Upgrade installed Agent**, choose **Upgrade this installed Agent, preserving identity**. Confirm the existing deployment name before copying. Installations made with earlier instructions may use `opsknight-agent`; enter that original name. Compose retains its project volume, Swarm updates only the existing service, Helm upgrades an existing release with its values and PVC, and Kustomize updates only that Deployment image. No new enrollment token is required. Persist the Kustomize image change in the saved overlay before applying it again.

To replace a lost or compromised identity, revoke the old Agent and create a new enrollment. Install using its new deployment name and a new empty identity volume. Never clone an enrolled identity or mount it into two running Agents. The native Linux installer operates one service per host; use the existing host's upgrade path to preserve identity.

The setup diagnostics distinguish endpoint and CA trust, verified image compatibility, enrollment, persistent identity, local policy and the first authenticated heartbeat. Run the generated connectivity check from the actual Agent host. A green control-plane page cannot prove that host's network or certificate trust.

Same-cluster fleet certification uses the same command generator as the UI. It installs two independent Agents on Swarm and with each Kubernetes method, checks distinct job claims, upgrades and restarts an identity, and removes one deployment before executing through its peer. Its local candidate/CA overlay does not certify published distribution or physical multi-node recovery.

Control-plane containers check schema readiness through the direct database connection, then check a real SQL query through the runtime endpoint before starting the application. This keeps authentication initialization from racing a newly deployed PgBouncer. Runtime connectivity waits up to 60 seconds by default; `OPSKNIGHT_RUNTIME_DATABASE_READY_TIMEOUT_MS` accepts a positive timeout up to 120000 ms. The container refuses startup if connectivity does not recover. Migration-only jobs do not depend on the runtime pooler.
