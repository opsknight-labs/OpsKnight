---
title: Install and operate Runbook Agents
description: Enroll, constrain, deploy, monitor, rotate, and recover OpsKnight outbound execution Agents.
type: deployment
product_area: runbooks
audience: [operator, administrator]
keywords: [runbook agent, enrollment, execution policy, scoped secrets, artifact output]
verification:
  level: source
  verified_at: 2026-10-04
  evidence:
    - agent/
    - deploy/compose/docker-compose.agent.yml
    - deploy/kubernetes/helm/opsknight/templates/agent.yaml
    - deploy/kubernetes/kustomize/components/agent/
    - deploy/swarm/docker-stack.agent.yml
---

# Install and operate Runbook Agents

Runbook Agents execute host, container, and Kubernetes actions without accepting inbound connections. Each Agent generates an Ed25519 key pair locally, enrolls with a single-use 15-minute token, signs every request, long-polls for work, renews its lease while running, and keeps unsent results in a durable local spool.

The Agent is separate from the Runbook Worker. The worker plans and reconciles database state; the Agent is the constrained execution plane close to the target.

The image healthcheck and Kubernetes startup, liveness, and readiness probes check an initialized local progress record and its running process. They do not contact OpsKnight: a temporary control-plane outage must not restart an otherwise functioning Agent or disrupt its durable result spool. Progress older than 90 seconds is unhealthy; Kubernetes permits up to five minutes for startup. An Agent reporting unavailable capabilities can still be locally healthy; review its effective capabilities in the UI before targeting it.

## Runbook authoring and operations UI

Advanced JSON edits are not saved implicitly. An unapplied-changes warning remains visible even when switching editor tabs, and draft saving is disabled until the JSON is applied to the builder or discarded with **Refresh JSON from builder**. Step editor identity remains stable during reordering and key edits.

The dedicated browser suite covers publication, service attachment and target selection, trigger configuration, incident suggestions, exact-plan approval, and cancellation. A separate journey covers enrollment, pool membership, scoped secret grants, and rotation. These tests use an isolated database and seed asynchronous worker transitions; they never execute host remediation. Precheck/verification controls reuse the typed step editor; library, execution, and Agent lists provide server-side pagination and filters.

The Runbooks library supports search, published/draft filters, and creation templates. Edit a draft through the ordered step builder and each step's configuration panel; define typed inputs in the Inputs tab. Advanced JSON is an explicit alternative, not the primary editor. Save the draft before publishing: the publish confirmation publishes only the saved version. Published versions remain immutable.

Service bindings show their selected version, target, inputs, and triggers together. Use **Configure** to change them. Machine-specific write actions cannot target a multi-member `LOCAL_HOSTS` pool; choose a specific Agent instead. Incident executions show ordered step progress and approvals for the exact frozen action and parameters. Cancellation, publication, revocation, and detach operations require confirmation.

**Runbooks → Agents** separates Agents, Pools, and Secrets. Pool membership and scoped secret grants are managed in their configuration panels; secret values remain masked and can be rotated without displaying the existing value. Secret-backed steps require HTTPS between the Agent and control plane. An HTTP polling Agent reports an explicit HTTPS-required error instead of receiving secret material.

**Runbooks → Health** shows queue and safety indicators, Agent heartbeat/spool attention, and worker state visible to the current process. In split deployments, a web process cannot certify the whole worker fleet; monitor each worker readiness endpoint separately. Execution-signing identity rotation and fleet/load certification remain separate future work.

## Safe enrollment sequence

1. In **Runbooks → Agents**, create an Agent and copy its one-time token.
2. Create or review a local `policy.json`. Start with diagnostics only.
3. Persist `/var/lib/opsknight-agent`; it contains the private identity and result spool.
4. Supply the token through a protected environment or Secret and start exactly one Agent.
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
Agents need the appropriate CLI and narrowly scoped runtime access. No overlay
automatically mounts host runtime sockets, enables privilege, or grants sudo.
For remote Podman access, supply operator-controlled runtime connection
configuration; do not expose unauthenticated sockets.

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

```sh
export OPSKNIGHT_AGENT_ENROLLMENT_TOKEN='<single-use-token>'
export OPSKNIGHT_AGENT_IMAGE='ghcr.io/opsknight-labs/opsknight-agent:2.0.0'
docker compose -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.agent.yml up -d opsknight-agent
```

For split Compose, set `OPSKNIGHT_AGENT_URL=http://opsknight-web:3000`. Mount the Docker socket only when Docker actions are required and accepted by your threat model. Host Systemd actions should use the native service instead of a container.

## Helm

Create the enrollment Secret outside Helm, then enable the single-replica Agent:

```sh
kubectl -n opsknight create secret generic opsknight-agent-enrollment \
  --from-literal=OPSKNIGHT_AGENT_ENROLLMENT_TOKEN='<single-use-token>' \
  --from-literal=OPSKNIGHT_EXECUTION_PUBLIC_KEY='<public-key-from-Agents-page>'

helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight -f values.production.yaml \
  --set agent.enabled=true \
  --set agent.enrollmentToken.existingSecret=opsknight-agent-enrollment
```

The chart grants no Kubernetes resource privileges or global HTTPS egress by default. To enable Kubernetes actions, add narrow namespaced `agent.rbac.rules`, align `agent.policy.kubernetesNamespaces`, and allow only the cluster control-plane endpoint through `agent.networkPolicy.kubernetesApiCIDRs`. Keep the Agent PVC across upgrades because it stores identity and queued results.

## Kustomize

Use `profiles/integrated-agent` or `profiles/split-agent`. Create the externally managed `opsknight-agent-enrollment` Secret before applying the profile; the component deliberately does not generate or commit token material. Pin both application and Agent images by digest. The component starts diagnostics-only with empty RBAC; an overlay enabling Kubernetes actions must also add narrow Role rules and an `ipBlock` egress rule for the cluster API endpoint.

```sh
kubectl -n opsknight create secret generic opsknight-agent-enrollment \
  --from-literal=enrollment-token='<single-use-token>' \
  --from-literal=OPSKNIGHT_EXECUTION_PUBLIC_KEY='<public-key-from-Agents-page>'
kubectl kustomize deploy/kubernetes/kustomize/profiles/split-agent > /tmp/opsknight.yaml
kubectl apply -f /tmp/opsknight.yaml
```

## Docker Swarm

Create an external Raft secret and deploy the Agent overlay with the selected integrated or split stack:

```sh
printf '%s' '<single-use-token>' | docker secret create opsknight_agent_enrollment_token -
export OPSKNIGHT_EXECUTION_PUBLIC_KEY='<public-key-from-Agents-page>'
export OPSKNIGHT_AGENT_IMAGE='ghcr.io/opsknight-labs/opsknight-agent:2.0.0'
docker stack deploy --with-registry-auth \
  -c deploy/swarm/docker-stack.yml \
  -c deploy/swarm/docker-stack.agent.yml opsknight
```

Use `OPSKNIGHT_AGENT_URL=http://opsknight-app:3000` with the integrated stack. The overlay deliberately runs one replica with a persistent identity volume.

## Native Linux service

Install the bundled module at `/usr/local/lib/opsknight-agent/opsknight-agent.mjs`, copy `agent/opsknight-agent.service`, create the `opsknight-agent` system user, and place configuration under `/etc/opsknight-agent`. The environment file needs `OPSKNIGHT_URL` and the enrollment token only for first start. Restrict both the environment file and identity directory to the service account.

## Monitoring and recovery

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

Fault-injection tests cover Agent crash/restart during artifact upload, renewal connectivity loss, exact start retries, trigger isolation, frozen suggestions, and signed payload tampering. These tests establish correctness under those failures; they are not fleet load certification. Before sizing a large fleet, measure idle-Agent and reconnect QPS, concurrent Runbook backlog, paging latency, database connections, and artifact WAL/backup growth. Artifacts remain bounded to 1 MiB compressed each in PostgreSQL with retention cleanup; plan storage capacity accordingly.

To replace a compromised Agent, revoke it in the UI, remove its identity volume, create a new enrollment, and review its secret grants. Revocation immediately prevents future signed claims. Output artifacts default to 30-day retention; set `RUNBOOK_ARTIFACT_RETENTION_DAYS` (1–3650) on the integrated runtime or dedicated Runbook Worker to match your incident-data retention policy.

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
