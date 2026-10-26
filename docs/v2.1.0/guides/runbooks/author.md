---
title: Author and publish a Runbook
description: Create a workflow with the ordered builder, typed inputs, optional nested checks, and explicit draft publication.
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

You need `runbook.manage` to create or edit drafts and `runbook.publish` to publish.
For Agent steps, arrange an appropriate execution Agent and policy before deployment.

## Prerequisites

- Active account with `runbook.manage` permission to create or edit drafts.
- `runbook.publish` permission if you plan to release drafts to responders.
- For agent-executed workflows, ensure target agents and pools are enrolled and healthy.

## Create a draft

1. Open **Runbooks → Library → New Runbook**.
2. Enter a name, unique slug, and optional description.
3. Select an empty, diagnostics, service-recovery, or Kubernetes-recovery template.
4. Create the Runbook. Recovery templates include approval before their restart action;
   they are examples, not production-ready policies for your service.

Use library search and the published/draft filter to find existing workflows.

## Configure ordered steps

In **Builder & Inputs → Builder**, select a step from the workflow list. On mobile, select a step to open its full-width editor and use **Back to steps** to return.
Set its name, unique key, instructions, action-specific parameters, timeout,
and approval requirement. Move steps up or down to change execution order.
For service recovery, configure diagnostics, inspect the actual unit, restart
only the intended unit, then verify the service and capture final diagnostics.

The server enforces minimum risk and approval regardless of editor labels.
The Agent policy must allow the exact executor and resource or command.
A builder setting cannot grant Unix permissions, Docker access, or Kubernetes RBAC.

## Define reusable inputs

In **Inputs**, add a unique key, label, type, optional default/help text, and
required flag. Use the supported input types in the [reference](../../reference/runbooks).
Service bindings provide concrete values. Configurable fields can reference
inputs using `${{ inputs.unit }}`. Secrets use `SECRET_REF` values such as
`secret://payments-api-token`, never plaintext credentials.

Input keys are committed on blur or Enter. Until then, the old key and its
references stay intact. A rename that collides with another committed or pending
key is rejected; resolve the collision before saving. Changing an input type also
normalizes its condition comparison values, or clears values requiring re-entry.
Defaults are validated during authoring, saving and publication. Numeric zero,
boolean false and empty optional defaults preserve their meanings. Secret
availability is checked separately from declaration validity.

**Validate draft** checks configuration without executing actions. The default
step timeout is 600 seconds; the overall deadline defaults to 3600 seconds.
Agent claims use a renewable 300-second lease. Agent policy can impose a tighter
maximum runtime. A lease is not a step timeout.

## Prechecks, verification, and Advanced JSON

In **Configure step**, use **Add precheck** under **Before action** and
**Add verification** under **After action**. Expand a check to edit it with
the same typed controls as a normal step; use its arrows to reorder or remove
it. Read-only, write, and approval badges identify its risk. Checks support
up to three nesting levels and ten checks per group; the server limits the
whole workflow to fifty steps, including checks.

A failed precheck prevents the action from running. Failed verification fails
the remediation workflow even when the action succeeded. Exit code zero alone
does not prove recovery. Existing checks are summarized on the step card.
**Advanced · Edit JSON** remains compatible with all nested definitions.
For example, a restart step can contain a read-only Systemd precheck and verification:

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
builder changes. After editing, select **Apply JSON to builder**, then **Save draft**.
Unapplied JSON displays a warning and disables saving, including after switching tabs.
Refresh asks before discarding unapplied JSON edits. Applying JSON asks before overwriting a modified visual draft. Browser and server use the same structural validation; runtime availability and policy checks remain separate.

## Save, publish, and verify

Save the draft and wait for **Changes saved**. Select **Publish draft**, review
the confirmation, and confirm. Only the saved draft is published. Verify the
published version in **Versions** before attaching it to a service. Published
versions are immutable; create a new draft to make further changes.

Continue with [service binding and incident response](./respond).

## Choose diagnostics, evidence and smart targets

Use typed Linux DNS, TCP or HTTP diagnostics for private service checks; ask the
Agent operator to allow the exact hostname and port locally. HTTP defaults to
status 200 and never follows redirects. Choose Systemd **logs** or Linux
**journal** for a bounded unit log snapshot. Container steps select Docker or
Podman explicitly; Kubernetes supports events, rollout status and scale.
Scaling is idempotent but still a write, subject to approvals, namespace/action
policy, replica limits and Kubernetes RBAC.

Attach read-only verification to the write action, checking the actual recovery
goal. Incident evidence compares the baseline and post-state. **Verified recovery**
appears only when the action, authored checks and healthy observed post-state
all pass; an exit code alone is not proof.

In service binding configuration, use **Agent selector (JSON)** for host labels,
for example `{"host":"${{ incident.labels.host }}","env":"prod"}`. Administrators
manage Agent labels and pool selectors under **Runbooks → Agents**; incident
labels come from `key=value` tags. Local write selectors must select exactly one
healthy capable host, which is pinned for the execution. Review automatic
budgets with your administrator; exhaustion produces a suggestion for responder
approval. See the [reference](../../reference/runbooks) for limits and semantics.

## Compare publication impact

Open **Compare versions and rule impact** before publishing or changing a rule's pin. Review added/removed/changed actions, derived risk, masked configuration, prechecks, verification and input changes side by side. Rules using latest publication track future publications; pinned rules and existing executions retain their frozen versions. Comparison performs no action and cannot establish platform permission.

## Service rule pages and version selection

Service automation lists show 20 rules per page. **Next rules** uses a stable creation-time/ID cursor; **First rules** returns to the newest page. Readiness checks and displayed counts apply to that visible page. Workflow and Agent/pool searches keep configuration inventories bounded; narrow the search when an option is absent. Existing pinned and current published versions remain available when configuring an attached rule.

For a new pinned rule, the selected version determines the input fields, target restrictions, review and saved version. If latest publication changes while a form is open, saving fails with a reload instruction before creating a rule. Invalid selector JSON, duplicate keys and invalid labels disable saving until corrected. Cards show the rule's state, target, blockers and last run; **Rule evidence** opens detailed checks/history, and **Manage rule** reveals editing, duplication and detach controls.

Version comparison authorizes both requested versions independently of the selector page. **Older versions** and **Newer versions** paginate the selector without losing the selected comparison.

## Automatic activation and scoped configuration

Viewing a service does not grant Runbook-library access. The Runbooks view requires `runbook.read.all`; other service views do not load the catalog, rules or Agent inventory. Catalog entries contain metadata, and selected version input/risk details are fetched through a separately authorized endpoint. Target/policy checks are requested from Rule evidence or **Check visible rule readiness**, rather than running for every ordinary page view.

Automatic rules always save paused, including configuration changes to an active rule. Open **Rule evidence**, validate configuration, request fresh Agent policy checks, and use **Activate Automatic rule**. Each selected Agent must have current successful policy evidence for the frozen version and inputs. A trigger with no conditions requires explicit confirmation that it may match every new incident for the service. Activation does not execute a workflow or bypass step approval, frozen-plan preview, target permission or unknown-outcome fences. Incident-context selectors and secret-dependent policy fields cannot be fully verified for activation in advance.

### Automatic target support and edits

Automatic activation supports a specific Agent (with static label restrictions) or a fixed pool without a label selector. Every currently eligible Agent must return a fresh successful policy check. Incident-dependent selectors and selector-only fleet targeting require Suggested mode; they cannot be activated as Automatic rules. Runtime dispatch still checks target eligibility, permissions, capabilities, secret grants and the frozen execution plan.

Saving an Automatic rule's configuration or trigger pauses it immediately. The configuration sheet warns before saving and links to **Rule evidence**. After each save, request local policy checks, review readiness, and explicitly reactivate. A zero-condition trigger requires confirmation that it may match every new incident for the service.

Trigger edits retain the trigger ID, pending and started suggestions, and historical execution associations. Each edit increments the condition revision and records the previous and new conditions in the audit. Existing suggestions retain their frozen execution plans.

For secret-backed Bash commands, use a static, exactly allowlisted command that reads the runtime `OPSKNIGHT_INPUT_<KEY>` environment variable. The Agent injects resolved input values at execution; never interpolate a secret into shell command source. Policy certification does not require the secret value when the command is static. Redacted executable commands or targets remain indeterminate and cannot certify Automatic activation. The `config.env` field does not configure the execution environment; use workflow inputs and their runtime environment variables.

Suggestions and triggered executions store the evaluated trigger revision separately from the current trigger. Editing conditions does not change that historical revision. Existing pre-migration records retain an unknown (`NULL`) revision; use their audit evidence rather than assume the current condition set matched.

Detaching a service rule archives and disables it. It disappears from the active service rule list; its evidence URL, original configuration, suggestions and execution associations remain available. Pending suggestions cannot start after detachment. Archived rules cannot be edited or reactivated.

Incident-trigger evaluation reads rules in ordered batches of at most 100, instead of loading the full inventory into memory. Every enabled rule is evaluated; duplicate event delivery retains existing fingerprint fences. Total processing time still grows with rule count and matching actions. The 100/1,000/10,000-rule regression measures concurrent duplicate deliveries and real suggestion writes; it does not certify sustained production incident throughput.

Automatic policy certification supports **1–100 eligible online Agents per target**, using durable per-Agent requests inserted in batches of 25. Activation requires fresh accepted evidence for every currently eligible Agent, with the same version, configuration and current policy hash. Membership, configuration or policy changes and expiry invalidate incomplete evidence; partial completion cannot activate the rule. Larger targets remain blocked.

Rule configuration saves increment a monotonic configuration revision. Incident evaluation verifies that revision, mode, selected publication and trigger revision under the workflow lock before recording a suggestion. A change to mode, version, inputs or target invalidates a match read before the edit committed.

Use **Rule history → Archived rules** on the service Runbooks tab to search detached rules by rule or workflow name. Historical configuration and execution links remain readable; archived rules have no dispatch controls. The rule detail page shows Configure → Validate → Activate → Monitor, including the number of Agents still awaiting valid policy evidence.

## Concurrent rule changes and pausing

Configuration and trigger forms carry the rule revision displayed when the form opened.
If another administrator saves, pauses, detaches or activates the rule first, a stale
save is rejected. Reload the page, review the current configuration, and apply your
changes again. A stale save does not overwrite the other administrator's work.

Pause and execution preparation serialize at the database transaction boundary.
If Pause obtains the lock first, a waiting start rechecks the disabled rule and
creates no execution. If execution preparation obtains the lock first, that
execution may commit before Pause completes. Pause prevents subsequent starts;
it does not cancel an execution already created. Cancel that execution separately
when appropriate. Trigger suggestions use the same rule boundary and revision checks.
