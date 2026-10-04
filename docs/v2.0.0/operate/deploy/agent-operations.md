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
5. Confirm the Agent becomes `ONLINE`, reports a policy hash, and has spool depth zero.
6. Add it to a `LOCAL_HOSTS` pool for machine-local actions or a `SHARED_TARGET` pool for a common cluster/API target.
7. Grant each referenced secret to only that Agent or pool.

Do not share an identity volume between running replicas. A token is single-use. Create a distinct enrollment for every independent Agent.

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
  --from-literal=OPSKNIGHT_AGENT_ENROLLMENT_TOKEN='<single-use-token>'

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
  --from-literal=enrollment-token='<single-use-token>'
kubectl kustomize deploy/kubernetes/kustomize/profiles/split-agent > /tmp/opsknight.yaml
kubectl apply -f /tmp/opsknight.yaml
```

## Docker Swarm

Create an external Raft secret and deploy the Agent overlay with the selected integrated or split stack:

```sh
printf '%s' '<single-use-token>' | docker secret create opsknight_agent_enrollment_token -
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

To replace a compromised Agent, revoke it in the UI, remove its identity volume, create a new enrollment, and review its secret grants. Revocation immediately prevents future signed claims. Preserve output artifacts according to your incident-data retention policy.
