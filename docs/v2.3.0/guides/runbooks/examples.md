---
title: Runbook action examples
description: Configure Kubernetes targets, read-only host checks, HTTP verification, Docker/Podman inspection, and static Bash commands with complete configuration examples.
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

Follow [Author and publish](./author) to create and validate each workflow.
Start with a manual service binding and [Preview execution](./respond) before
executing against a target you are authorized to operate. Preview does not
run commands.

## Prerequisites

1. Familiarize yourself with the [authoring guide](./author), especially
   step types and risk classes.
2. Ensure you have configured at least one target Agent with appropriate local
   execution policies.
3. Verify required credentials are configured in **Runbooks → Agents →
   Secrets**.

## Example 1: Kubernetes recovery with shared target

Choose the **Kubernetes recovery** template. This example declares inputs and
uses them across inspection, restart, and verification steps.

### Input configuration

| Key               | Type   | Example value | Description                 |
| ----------------- | ------ | ------------- | --------------------------- |
| `namespace`       | STRING | `payments`    | Target Kubernetes namespace |
| `deployment_name` | STRING | `checkout`    | Deployment to restart       |

### Step configuration

```json
{
  "steps": [
    {
      "key": "inspect-events",
      "name": "Check namespace events",
      "type": "KUBERNETES",
      "riskClass": "READ_ONLY",
      "config": {
        "action": "events",
        "namespace": "${{ inputs.namespace }}"
      }
    },
    {
      "key": "check-rollout",
      "name": "Current rollout status",
      "type": "KUBERNETES",
      "riskClass": "READ_ONLY",
      "config": {
        "action": "rollout-status",
        "namespace": "${{ inputs.namespace }}",
        "resource": "deployment",
        "name": "${{ inputs.deployment_name }}"
      }
    },
    {
      "key": "restart",
      "name": "Restart ${{ inputs.deployment_name }}",
      "type": "KUBERNETES",
      "riskClass": "NON_IDEMPOTENT",
      "requiresApproval": true,
      "config": {
        "action": "rollout-restart",
        "namespace": "${{ inputs.namespace }}",
        "resource": "deployment",
        "name": "${{ inputs.deployment_name }}"
      },
      "verification": {
        "steps": [
          {
            "key": "verify-rollout",
            "name": "Verify rollout converged",
            "type": "KUBERNETES",
            "riskClass": "READ_ONLY",
            "config": {
              "action": "rollout-status",
              "namespace": "${{ inputs.namespace }}",
              "resource": "deployment",
              "name": "${{ inputs.deployment_name }}"
            }
          }
        ]
      }
    }
  ]
}
```

### Agent requirements

- Kubernetes capability with a working cluster connection.
- Local namespace/action allowlists permitting the target namespace.
- Namespaced RBAC for the specific resources.
- API egress to the Kubernetes API server.

Cluster access is configured on the Agent; kubeconfig paths are not Runbook
configuration fields. An uncertain result requires inspection before another
restart.

## Example 2: Kubernetes scale with input validation

```json
{
  "key": "scale-down",
  "name": "Scale ${{ inputs.deployment_name }} to ${{ inputs.replicas }}",
  "type": "KUBERNETES",
  "riskClass": "IDEMPOTENT_WRITE",
  "requiresApproval": true,
  "config": {
    "action": "scale",
    "namespace": "${{ inputs.namespace }}",
    "resource": "deployment",
    "name": "${{ inputs.deployment_name }}",
    "replicas": "${{ inputs.replicas }}"
  }
}
```

Use a `NUMBER` input for `replicas`; the resolved value must be an integer.
Scale is idempotent but still a write, subject to approvals and the Agent's
`kubernetesMaxReplicas` policy.

## Example 3: Docker or Podman inspection

```json
{
  "key": "inspect-container",
  "name": "Inspect checkout container",
  "type": "DOCKER",
  "riskClass": "READ_ONLY",
  "config": {
    "action": "inspect",
    "container": "checkout",
    "runtime": "docker"
  }
}
```

- Keep risk `READ_ONLY` for inspection.
- Select an Agent that can reach the exact runtime.
- Allow the container through `dockerContainers` policy (or
  `podmanContainers` for Podman).
- Runtime socket permissions remain an independent requirement.
- Inspection returns bounded output; an absent container fails clearly.

For Podman, set `"runtime": "podman"` and verify the Agent reports the Podman
capability.

## Example 4: Docker health check

```json
{
  "key": "health-check",
  "name": "Check container health",
  "type": "DOCKER",
  "riskClass": "READ_ONLY",
  "config": {
    "action": "health",
    "container": "api-server",
    "runtime": "docker"
  }
}
```

The health action requires a configured Docker healthcheck reporting
`healthy`. Merely running, starting, unhealthy, or absent healthchecks do
not pass this action.

## Example 5: Safe systemd checks

```json
{
  "steps": [
    {
      "key": "status",
      "name": "Check payments-api status",
      "type": "SYSTEMD",
      "riskClass": "READ_ONLY",
      "config": {
        "action": "status",
        "unit": "payments-api.service"
      }
    },
    {
      "key": "logs",
      "name": "Recent API logs",
      "type": "SYSTEMD",
      "riskClass": "READ_ONLY",
      "config": {
        "action": "logs",
        "unit": "payments-api.service",
        "lines": 100
      }
    }
  ]
}
```

- Allow the unit through `systemdUnits` on a host Agent.
- A container Agent normally cannot operate the host's systemd without
  additional configuration.
- Logs support 1–500 lines.
- Service checks are read-only; restart actions require approval and host
  permissions.

## Example 6: Systemd service recovery with prechecks

```json
{
  "key": "restart-api",
  "name": "Restart payments-api",
  "type": "SYSTEMD",
  "riskClass": "NON_IDEMPOTENT",
  "requiresApproval": true,
  "config": {
    "action": "restart",
    "unit": "payments-api.service"
  },
  "precheck": {
    "steps": [
      {
        "key": "pre-status",
        "name": "Pre-restart status",
        "type": "SYSTEMD",
        "riskClass": "READ_ONLY",
        "config": { "action": "status", "unit": "payments-api.service" }
      }
    ]
  },
  "verification": {
    "steps": [
      {
        "key": "post-status",
        "name": "Post-restart verification",
        "type": "SYSTEMD",
        "riskClass": "READ_ONLY",
        "config": {
          "action": "status",
          "unit": "payments-api.service",
          "expectedState": "active"
        }
      }
    ]
  }
}
```

## Example 7: Linux diagnostics workflow

```json
{
  "steps": [
    {
      "key": "summary",
      "name": "System summary",
      "type": "LINUX_DIAGNOSTICS",
      "riskClass": "READ_ONLY",
      "config": { "diagnostic": "summary" }
    },
    {
      "key": "memory",
      "name": "Memory utilization",
      "type": "LINUX_DIAGNOSTICS",
      "riskClass": "READ_ONLY",
      "config": { "diagnostic": "memory" }
    },
    {
      "key": "disk",
      "name": "Disk usage",
      "type": "LINUX_DIAGNOSTICS",
      "riskClass": "READ_ONLY",
      "config": { "diagnostic": "disk" }
    },
    {
      "key": "dns-check",
      "name": "DNS resolution for API",
      "type": "LINUX_DIAGNOSTICS",
      "riskClass": "READ_ONLY",
      "config": {
        "diagnostic": "dns",
        "hostname": "api.internal.example.com"
      }
    },
    {
      "key": "tcp-check",
      "name": "TCP connectivity to database",
      "type": "LINUX_DIAGNOSTICS",
      "riskClass": "READ_ONLY",
      "config": {
        "diagnostic": "tcp",
        "host": "db.internal.example.com",
        "port": 5432
      }
    },
    {
      "key": "http-check",
      "name": "Health endpoint check",
      "type": "LINUX_DIAGNOSTICS",
      "riskClass": "READ_ONLY",
      "config": {
        "diagnostic": "http",
        "url": "https://api.internal.example.com/health",
        "expectedStatus": 200
      }
    }
  ]
}
```

Agent-local HTTP checks can reach private services only when both the exact
hostname and port are in local `networkHosts` / `networkPorts`. Redirects and
URL credentials are rejected. DNS uses an allowlisted host and port 53.

## Example 8: HTTP verification (control plane)

```json
{
  "key": "verify-health",
  "name": "Verify service health",
  "type": "HTTP",
  "riskClass": "READ_ONLY",
  "config": {
    "method": "GET",
    "url": "https://status.example.com/health",
    "expectedStatus": 200,
    "headers": { "Accept": "application/json" }
  }
}
```

- HTTP steps run on the **control plane**, using its outbound URL
  restrictions.
- They do **not** use Agent-local `networkHosts` policy.
- Redirects are rejected; response output is bounded.
- A different expected status fails the step.
- Place this under **After action** when it should verify recovery.
- HTTP actions do **not** resolve `SECRET_REF` inputs. Use an Agent executor
  for secret-backed requests.

## Example 9: Static Bash command with input environment

Declare STRING input `service` with value `payments-api.service`:

```bash
systemctl is-active -- "$OPSKNIGHT_INPUT_SERVICE"
```

### Agent policy

```json
{
  "allowedStepTypes": ["BASH"],
  "allowNonIdempotent": true,
  "bashCommandPatterns": ["systemctl is-active -- \"$OPSKNIGHT_INPUT_SERVICE\""],
  "maxRuntimeSeconds": 300,
  "maxOutputBytes": 1048576
}
```

Key points:

- Bash steps are classified `NON_IDEMPOTENT` and require approval even when
  the command only reads state.
- Matching is **exact** — interpolating the command text with
  `${{ inputs.service }}` would change it and break the static allowlist.
- Environment variables preserve the command text.
- Policy does not grant Unix privileges.
- Restart the Agent after changing policy and verify its new policy hash.
- Never print credentials, including secret-backed environment inputs.

For secret-backed Bash commands, use a static, exactly allowlisted command
that reads the runtime `OPSKNIGHT_INPUT_<KEY>` environment variable. The
Agent injects resolved input values at execution; never interpolate a secret
into shell command source.

## Example 10: CONDITION gate

```json
{
  "key": "check-urgency",
  "name": "Only proceed for HIGH urgency",
  "type": "CONDITION",
  "riskClass": "READ_ONLY",
  "config": {
    "field": "incident.urgency",
    "operator": "EQUALS",
    "value": "HIGH"
  }
}
```

A false CONDITION skips itself and all remaining pending workflow steps. It is
a workflow gate, not an if/else branch. Incident/service values are read when
the condition executes, not frozen at execution creation.

## Example 11: WAIT step

```json
{
  "key": "cooldown",
  "name": "Wait 30 seconds for service stabilization",
  "type": "WAIT",
  "riskClass": "READ_ONLY",
  "config": {
    "durationSeconds": 30
  }
}
```

Duration range: 0–86400 seconds. Subject to the step timeout and overall
deadline. Fields named `seconds` are not WAIT duration controls.

## Advanced options

The visual editor provides action targets, parameters, safety checks,
approval, and step timeout. Use **Advanced JSON** for:

- `maxRetries` on individual steps.
- `defaultTimeoutSeconds` on the definition (overall deadline).

Applying JSON runs the same validation as the visual editor. Unknown outcomes
are governed by the engine's retry safety rules; a configured retry count
cannot authorize repeating an uncertain non-idempotent write.

See [Runbook reference](../../reference/runbooks) for complete limits.
