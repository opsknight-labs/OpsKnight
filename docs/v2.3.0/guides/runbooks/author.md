---
title: Author and publish a Runbook
description: Create workflows with all 9 step types, define typed inputs, configure prechecks and verification, and publish immutable versions.
type: how-to
product_area: runbooks
audience: [administrator, operator]
verification:
  level: test
  verified_at: 2026-10-14
  evidence:
    [
      src/components/runbooks/RunbookBuilder.tsx,
      src/components/runbooks/RunbookLibrary.tsx,
      tests/e2e/runbooks-ui.spec.ts,
    ]
---

# Author and publish a Runbook

You need `runbook.manage` to create or edit drafts and `runbook.publish` to
publish. For Agent-executed steps, arrange an appropriate execution Agent and
policy before deployment.

## Prerequisites

- Active account with `runbook.manage` permission to create or edit drafts.
- `runbook.publish` permission to release drafts to responders.
- For Agent-executed workflows, enrolled and healthy target Agents with
  appropriate local execution policies.
- Familiarity with the [risk model](../../concepts/runbooks#risk-model-and-approval).

## Create a draft

1. Open **Runbooks → Library → New Runbook**.
2. Enter a name, unique slug, and optional description.
3. Select a template:
   - **Empty** — blank workflow.
   - **Diagnostics** — read-only system inspection.
   - **Service recovery** — diagnostics + restart + verification (includes
     approval gate).
   - **Kubernetes recovery** — namespace-scoped rollout restart with
     verification.
4. Create the Runbook. Recovery templates include approval before their
   restart action; they are examples, not production-ready policies for your
   service.

Use library search and the published/draft filter to find existing workflows.
The library supports text, publication state, owner, and service filters with
stable 20-row pages.

## Step types reference

OpsKnight supports 9 step types. Each type has a minimum risk floor that the
server enforces regardless of the author's label.

### Control-flow steps (no Agent required)

| Type        | Purpose                                                            | Risk             | Configuration                                        |
| ----------- | ------------------------------------------------------------------ | ---------------- | ---------------------------------------------------- |
| `MANUAL`    | Human instruction — display text for the responder                 | `READ_ONLY`      | `instructions`, `description`                        |
| `APPROVAL`  | Explicit approval gate (distinct from per-step `requiresApproval`) | `READ_ONLY`      | `instructions`, `description`                        |
| `CONDITION` | Workflow gate — false skips all remaining pending steps            | `READ_ONLY`      | `field`, `operator`, `value`                         |
| `WAIT`      | Timed pause                                                        | `READ_ONLY`      | `durationSeconds` (0–86400)                          |
| `HTTP`      | Control-plane HTTP request (outbound URL restrictions apply)       | Varies by method | `method`, `url`, `headers`, `body`, `expectedStatus` |

### Agent-executed steps

| Type                | Purpose                                | Risk range                     | Configuration                                         |
| ------------------- | -------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| `LINUX_DIAGNOSTICS` | System inspection (12 sub-types)       | `READ_ONLY`                    | `diagnostic`, plus sub-type fields                    |
| `SYSTEMD`           | Systemd service lifecycle              | `READ_ONLY` → `NON_IDEMPOTENT` | `action`, `unit`, `lines`, `expectedState`            |
| `DOCKER`            | Container lifecycle (Docker or Podman) | `READ_ONLY` → `NON_IDEMPOTENT` | `action`, `container`, `runtime`                      |
| `KUBERNETES`        | Cluster resource operations            | `READ_ONLY` → `NON_IDEMPOTENT` | `action`, `namespace`, `resource`, `name`, `replicas` |
| `BASH`              | Shell command execution                | `NON_IDEMPOTENT` (always)      | `command` (max 8 KiB)                                 |

### LINUX_DIAGNOSTICS sub-types

| Diagnostic   | Required fields                   | What it inspects                    |
| ------------ | --------------------------------- | ----------------------------------- |
| `summary`    | —                                 | Overall system summary              |
| `disk`       | —                                 | Disk usage and mount points         |
| `memory`     | —                                 | Memory utilization                  |
| `processes`  | —                                 | Running process list                |
| `network`    | —                                 | Network interfaces and connections  |
| `listeners`  | —                                 | Active listening ports              |
| `process`    | `pattern`                         | Processes matching a search pattern |
| `filesystem` | `path`                            | Specific filesystem path details    |
| `journal`    | `unit`, `lines` (1–500)           | Systemd journal entries for a unit  |
| `dns`        | `hostname`                        | DNS resolution for a hostname       |
| `tcp`        | `host`, `port` (1–65535)          | TCP connectivity check              |
| `http`       | `url`, `expectedStatus` (100–599) | HTTP health check (Agent-local)     |

### SYSTEMD actions and risk

| Action    | Risk               | Notes                                  |
| --------- | ------------------ | -------------------------------------- |
| `status`  | `READ_ONLY`        | Check unit state                       |
| `logs`    | `READ_ONLY`        | Retrieve 1–500 lines of journal output |
| `start`   | `IDEMPOTENT_WRITE` | Start a stopped unit                   |
| `stop`    | `IDEMPOTENT_WRITE` | Stop a running unit                    |
| `restart` | `NON_IDEMPOTENT`   | Restart — requires approval            |

### DOCKER actions and risk

| Action    | Risk               | Notes                                                                      |
| --------- | ------------------ | -------------------------------------------------------------------------- |
| `inspect` | `READ_ONLY`        | Container metadata and state                                               |
| `logs`    | `READ_ONLY`        | Container log output                                                       |
| `health`  | `READ_ONLY`        | Healthcheck status — requires a configured healthcheck reporting `healthy` |
| `start`   | `IDEMPOTENT_WRITE` | Start a stopped container                                                  |
| `stop`    | `IDEMPOTENT_WRITE` | Stop a running container                                                   |
| `restart` | `NON_IDEMPOTENT`   | Restart — requires approval                                                |

Set `runtime` to `"docker"` (default) or `"podman"`. Podman uses an independent
`podmanContainers` allowlist and the effective Podman capability.

### KUBERNETES actions and risk

| Action            | Risk               | Supported resources                                        | Notes                         |
| ----------------- | ------------------ | ---------------------------------------------------------- | ----------------------------- |
| `get`             | `READ_ONLY`        | All                                                        | Retrieve resource details     |
| `describe`        | `READ_ONLY`        | All                                                        | Extended resource description |
| `logs`            | `READ_ONLY`        | pod, deployment, daemonset, statefulset                    | Pod log output                |
| `events`          | `READ_ONLY`        | All                                                        | Namespace event stream        |
| `rollout-status`  | `READ_ONLY`        | deployment, daemonset, statefulset                         | Rollout convergence           |
| `rollout-restart` | `NON_IDEMPOTENT`   | deployment, daemonset, statefulset                         | Rolling restart               |
| `scale`           | `IDEMPOTENT_WRITE` | deployment, statefulset, replicaset, replicationcontroller | Set replica count             |

Scale requires an integer `replicas` value and local `kubernetesMaxReplicas`
authorization. Platform RBAC is an independent boundary.

### HTTP method risk mapping

| Method          | Risk                                        |
| --------------- | ------------------------------------------- |
| `GET`, `HEAD`   | `READ_ONLY` — cannot include a request body |
| `PUT`, `DELETE` | `IDEMPOTENT_WRITE`                          |
| `POST`, `PATCH` | `NON_IDEMPOTENT`                            |

HTTP steps run on the **control plane** and use its outbound URL restrictions.
They reject private, loopback, link-local, and metadata endpoints. HTTP steps
**cannot** consume `SECRET_REF` inputs — use an Agent executor for
secret-backed requests.

Headers use a JSON object with string values (max 64 entries, 16 KiB total).
Without an expected status, any 2xx response succeeds. Config max is 96 KiB
(larger than other step types at 32 KiB).

### BASH executor details

`BASH` steps run with Bash, not POSIX `sh`. The container Agent includes Bash;
native Agents must install Bash on their `PATH`. Commands use a non-login,
non-interactive shell without profile/rc or inherited `BASH_ENV` startup files.

Bash steps are always classified `NON_IDEMPOTENT` and require approval, even
when the command only reads state. Use `OPSKNIGHT_INPUT_<KEY>` environment
variables for input values — never interpolate secrets into command text.

## Configure ordered steps

In **Builder & Inputs → Builder**, select a step from the workflow list. On
mobile, select a step to open its full-width editor and use **Back to steps**
to return.

For each step, configure:

- **Name** — descriptive name (can use `${{ inputs.key }}` templates).
- **Key** — unique identifier within the workflow (lowercase).
- **Type** — one of the 9 step types above.
- **Action/diagnostic** — type-specific action or diagnostic sub-type.
- **Configuration** — action-specific parameters.
- **Risk class** — the server enforces minimum risk regardless of your selection.
- **Timeout** — step-level timeout (default 600 seconds).
- **Approval** — whether explicit approval is required before this step.

Move steps up or down to change execution order. For a service recovery
workflow, configure: diagnostics → inspect the actual unit → restart only the
intended unit → verify the service → capture final diagnostics.

The server enforces minimum risk and approval regardless of editor labels.
The Agent policy must allow the exact executor and resource or command.
A builder setting cannot grant Unix permissions, Docker access, or Kubernetes
RBAC.

## Define reusable inputs

In **Inputs**, add typed input definitions that service bindings provide
concrete values for:

| Field             | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| **Key**           | Unique identifier (lowercase), committed on blur or Enter                        |
| **Label**         | Human-readable display label                                                     |
| **Type**          | One of: `STRING`, `NUMBER`, `BOOLEAN`, `URL`, `DURATION`, `SECRET_REF`, `SELECT` |
| **Required**      | Whether a value must be provided                                                 |
| **Default value** | Optional default (validated during authoring, saving, and publication)           |
| **Help text**     | Optional description shown to responders                                         |
| **Options**       | Required for `SELECT` type — explicit unique options                             |

### Input type details

| Type         | Storage          | Behavior                                          |
| ------------ | ---------------- | ------------------------------------------------- |
| `STRING`     | String           | Free text                                         |
| `NUMBER`     | String → Number  | Coerced via `Number()`, must be finite            |
| `BOOLEAN`    | String → Boolean | `"true"` → `true`, else `false`                   |
| `URL`        | String           | Displayed and validated as URL                    |
| `DURATION`   | String           | Duration string                                   |
| `SECRET_REF` | String           | Stored as `secret://<name>`, resolved at dispatch |
| `SELECT`     | String           | Must match one of the declared `options[]` values |

### Input templates

Reference inputs in step configuration using the `${{ inputs.key }}` syntax:

- When used alone (exact match), the typed value is preserved.
- When embedded in a larger string, the value is coerced to a string.
- Keys must be lowercase.

`SECRET_REF` inputs use the `secret://` protocol: `secret://payments-api-token`.
Never paste plaintext credentials into definitions or binding values. Secrets
require HTTPS transport and a scoped grant on the target Agent or pool.

### Input key behavior

- Keys are committed on blur or Enter. Until then, the old key and its
  references stay intact.
- A rename that collides with another committed or pending key is rejected.
- Changing an input type normalizes condition comparison values or clears
  values requiring re-entry.
- Numeric zero, boolean false, and empty optional defaults preserve their
  meanings.
- Maximum: 30 input definitions per workflow.

## Prechecks and verification

In **Configure step**, use:

- **Add precheck** under **Before action** — runs before the main action.
- **Add verification** under **After action** — runs after the main action.

Expand a check to edit it with the same typed controls as a normal step. Use
its arrows to reorder or remove it. Read-only, write, and approval badges
identify its risk.

| Check type   | Behavior                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| Precheck     | A failed precheck **prevents** the action from running                    |
| Verification | Failed verification **fails the workflow** even when the action succeeded |

Exit code zero alone does not prove recovery. Existing checks are summarized
on the step card.

### Nesting limits

- Up to **3 nesting levels** per check group.
- Up to **10 checks** per group.
- The server limits the whole workflow to **50 steps** total, including nested
  checks.

> **Note on `verification.delaySeconds`**: This field exists in the schema
> but is **blocked at runtime**. Use an explicit `WAIT` step before your
> verification checks instead.

### Advanced JSON editing

**Advanced · Edit JSON** remains compatible with all nested definitions:

```json
{
  "steps": [
    {
      "key": "restart",
      "name": "Restart API",
      "type": "SYSTEMD",
      "riskClass": "NON_IDEMPOTENT",
      "requiresApproval": true,
      "config": { "action": "restart", "unit": "api.service" },
      "precheck": {
        "steps": [
          {
            "key": "before",
            "name": "Inspect API",
            "type": "SYSTEMD",
            "riskClass": "READ_ONLY",
            "config": { "action": "status", "unit": "api.service" }
          }
        ]
      },
      "verification": {
        "steps": [
          {
            "key": "after",
            "name": "Verify API",
            "type": "SYSTEMD",
            "riskClass": "READ_ONLY",
            "config": { "action": "status", "unit": "api.service" }
          }
        ]
      }
    }
  ]
}
```

Before editing JSON, select **Refresh JSON from builder** to include current
builder changes. After editing, select **Apply JSON to builder**, then
**Save draft**. Unapplied JSON displays a warning and disables saving,
including after switching tabs. Browser and server use the same structural
validation; runtime availability and policy checks remain separate.

### Step-level configuration fields

Every step supports these fields:

```text
{
  "key": "string",
  "name": "string",
  "type": "RunbookStepType",
  "riskClass": "RunbookRiskClass",
  "description": "string (optional)",
  "config": {},
  "timeoutSeconds": 600,
  "maxRetries": 0,
  "requiresApproval": false,
  "precheck": { "steps": [] },
  "verification": { "steps": [] }
}
```

Use `maxRetries` through Advanced JSON. Retry safety follows the risk class:
read-only steps can retry after UNKNOWN outcomes, idempotent writes retry on
failure but not after UNKNOWN, non-idempotent steps never auto-retry.

## Save, publish, and verify

1. Save the draft and wait for **Changes saved**.
2. Select **Validate draft** — checks configuration without executing actions.
   The default step timeout is 600 seconds; the overall deadline defaults to
   3600 seconds. Agent claims use a renewable 300-second lease.
3. Select **Publish draft**, review the confirmation, and confirm.
4. Only the **saved** draft is published — unsaved editor contents are not
   included.
5. Verify the published version in **Versions** before attaching it to a
   service.

Published versions are immutable; create a new draft to make further changes.
Drafts use optimistic locking via `draftRevision` — concurrent edits are
safely rejected.

## Version lifecycle

| State       | Meaning                                                       | Editable |
| ----------- | ------------------------------------------------------------- | -------- |
| `DRAFT`     | Work in progress — only one draft per Runbook                 | Yes      |
| `PUBLISHED` | Immutable, checksummed version available for service bindings | No       |
| `RETIRED`   | Removed from active use, preserved for audit                  | No       |

### Version management operations

| Operation              | Required permission | Notes                                         |
| ---------------------- | ------------------- | --------------------------------------------- |
| Create Runbook         | `runbook.manage`    | Supports templates and JSON import            |
| Save draft             | `runbook.manage`    | Optimistic locking via `draftRevision`        |
| Publish draft          | `runbook.publish`   | Draft → PUBLISHED; immutable after            |
| Clone version to draft | `runbook.manage`    | Creates new draft from any version            |
| Retire version         | `runbook.publish`   | Only non-current published versions           |
| Archive Runbook        | `runbook.manage`    | Soft-delete; preserves history                |
| Restore Runbook        | `runbook.manage`    | Un-archives; bindings remain disabled         |
| Delete Runbook         | `runbook.manage`    | Only if no executions or published versions   |
| Duplicate Runbook      | `runbook.manage`    | Creates a new draft copy                      |
| Export                 | `runbook.read.all`  | JSON portable format, max 512 KiB             |
| Import                 | `runbook.manage`    | Parse + slug deduplication (up to 5 attempts) |

## Compare publication impact

Open **Compare versions and rule impact** before publishing or changing a
rule's pin:

- Review added/removed/changed actions, derived risk, masked configuration,
  prechecks, verification, and input changes side by side.
- Rules using latest publication track future publications; pinned rules and
  existing executions retain their frozen versions.
- Comparison performs no action and cannot establish platform permission.

## Diagnostics and smart targets

Use typed Linux DNS, TCP, or HTTP diagnostics for private service checks. Ask
the Agent operator to allow the exact hostname and port locally:

- **HTTP** defaults to status 200 and never follows redirects.
- **Systemd logs** or **Linux journal** provide bounded unit log snapshots.
- **Container steps** select Docker or Podman explicitly.
- **Kubernetes** supports events, rollout status, and scale.

Scaling is idempotent but still a write, subject to approvals, namespace/action
policy, replica limits, and Kubernetes RBAC.

### Agent selector (JSON)

In service binding configuration, use **Agent selector (JSON)** for host
labels:

```text
{ "host": "${{ incident.labels.host }}", "env": "prod" }
```

Administrators manage Agent labels and pool selectors under **Runbooks →
Agents**. Incident labels come from `key=value` tags. Local write selectors
must select exactly one healthy capable host, which is pinned for the
execution.

## Continue with

- [Service binding and incident response](./respond)
- [Agents, pools, and scoped secrets](./agents-pools-secrets)
- [Action examples](./examples)
- [Runbook reference](../../reference/runbooks) for complete limits and
  semantics
