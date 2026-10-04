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

`agent/policy.container.json` is the fail-closed diagnostics-only baseline; `agent/policy.example.json` demonstrates an explicitly allowlisted native service. `allowedStepTypes` enables executors; the Systemd unit, Docker container, Kubernetes namespace, and Bash command lists further constrain targets. A trailing `*` is the only wildcard for resource-name allowlists. Bash commands require an exact match so an allowed prefix cannot append another shell operation. Non-idempotent actions remain disabled unless `allowNonIdempotent` is explicitly enabled.

Platform authorization is a second boundary. Kubernetes RBAC, Docker socket access, Unix permissions, sudoers, or polkit must grant only the operations the local policy allows. A policy entry never grants an operating-system permission by itself.

Validated runbook inputs are exposed to child processes as `OPSKNIGHT_INPUT_<UPPERCASE_KEY>`. Secret-reference inputs are resolved only after a scoped grant check and their values are redacted from previews and uploaded output before leaving the Agent. Avoid printing credentials even with this defense.

Restart the Agent after changing policy. Verify that the policy hash changes in the Agent screen.

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
