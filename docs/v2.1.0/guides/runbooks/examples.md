---
title: Runbook action examples
description: Configure shared Kubernetes targets, read-only host checks, HTTP verification, and static Bash commands.
type: how-to
product_area: runbooks
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-11
  evidence:
    [
      src/lib/runbooks/shared-definition.ts,
      src/lib/runbooks/builder.ts,
      agent/src/policy.ts,
      agent/policy.example.json,
    ]
---

# Runbook action examples

Follow [Author and publish](./author) to create and validate each workflow. Start
with a manual service binding and [Preview execution](./respond) before executing
against a target you are authorized to operate. Preview does not run commands.

## Prerequisites

1. Familiarize yourself with the workflow authoring guide in [Author and publish](./author).
2. Ensure you have configured at least one target agent with appropriate local execution policies.
3. Verify required credentials or service accounts are configured in **Runbooks → Agents → Secrets**.

## Kubernetes recovery with one shared target

Choose the Kubernetes recovery template. Declare `namespace` and `deployment_name`
as STRING inputs and bind their values to `payments` and `checkout`. Keep all
inspection, restart, rollout-status, and verification steps referencing those
same inputs. Change the binding values to move the whole recovery journey.

In the Kubernetes editor, choose the action and its supported resource. For a
rollout restart use resource `deployment` and `${{ inputs.deployment_name }}` in namespace
`${{ inputs.namespace }}`. Retain the mandatory approval and rollout verification.
For scale, use a NUMBER input for replicas; the resolved value must be an integer.

The selected Agent needs the Kubernetes capability, a working cluster connection,
local namespace/action allowlists, namespaced RBAC, and API egress. Cluster access
is configured on the Agent; arbitrary kubeconfig paths or cluster contexts are
not runbook configuration fields. A restart is non-idempotent. An uncertain
result requires inspection before another restart. A successful authored
verification records proof; merely configuring checks does not certify recovery.

## Docker or Podman inspection

Add a Docker step with action **Inspect**, runtime **Docker**, and container
`checkout`. Keep risk READ_ONLY. Select an Agent that can reach that exact runtime
and allow the container through `dockerContainers`. For Podman select **Podman**,
use `podmanContainers`, and verify the reported Podman capability. Runtime socket
permissions remain an independent requirement. Inspection returns bounded output;
an absent container or inaccessible socket fails clearly rather than granting access.

## Safe systemd checks

Add a Systemd **Status** step for `payments-api.service`. To inspect recent events,
add **Logs** and request 100 lines (the supported range is 1–500). Allow that unit
through `systemdUnits` on a host Agent. A container Agent normally cannot operate
the host's systemd without additional operator configuration. Service checks are
read-only; restart actions require approval and the corresponding host permissions.

## HTTP verification

Add an HTTP GET step for `https://status.example.com/health` with expected status 200. Leave the body empty. Headers use a JSON object with string values, for example
`{"Accept":"application/json"}`. This action runs on the control plane and uses
its outbound URL restrictions; it does not use Agent-local `networkHosts` policy.
Redirects are rejected and response output is bounded. A different expected status
fails the step. Put this step under **After action** when it should verify recovery.
HTTP actions do not resolve SECRET_REF inputs into credentials. Use an appropriately
configured Agent executor for secret-backed requests.

## Static Bash command and input environment

Declare STRING input `service` with value `payments-api.service`, then use the
following exact command in both the Bash editor and the Agent policy:

```bash
systemctl is-active -- "$OPSKNIGHT_INPUT_SERVICE"
```

```json
{
  "allowedStepTypes": ["BASH"],
  "allowNonIdempotent": true,
  "bashCommandPatterns": ["systemctl is-active -- \"$OPSKNIGHT_INPUT_SERVICE\""],
  "maxRuntimeSeconds": 300,
  "maxOutputBytes": 1048576
}
```

Bash steps are classified NON_IDEMPOTENT and require approval even when this
particular command reads state. Matching is exact; interpolating the command text
with `${{ inputs.service }}` would change it and break the static allowlist.
Environment variables preserve the command text. Policy does not grant Unix
privileges. Restart the Agent after changing policy and verify its new policy hash.
Do not print credentials, including secret-backed environment inputs.

## Advanced options

The visual editor provides action targets, parameters, safety checks, approval,
and step timeout. Use **Advanced JSON** for `maxRetries` on individual steps and
`defaultTimeoutSeconds` on the definition (the overall deadline). Applying JSON runs the
same validation as the visual editor. Unknown outcomes are governed by the engine's
retry safety rules; a configured retry count cannot authorize repeating an uncertain
non-idempotent write. See [Runbook reference](../../reference/runbooks) for limits.
