---
title: Author and publish a Runbook
description: Create a workflow with the ordered builder, typed inputs, optional nested checks, and explicit draft publication.
type: how-to
product_area: runbooks
audience: [administrator, operator]
verification:
  level: test
  verified_at: 2026-10-04
  evidence: [src/components/runbooks/RunbookBuilder.tsx, src/components/runbooks/RunbookLibrary.tsx, tests/e2e/runbooks-ui.spec.ts]
---

# Author and publish a Runbook

You need `runbook.manage` to create or edit drafts and `runbook.publish` to publish.
For Agent steps, arrange an appropriate execution Agent and policy before deployment.

## Create a draft

1. Open **Runbooks → Library → New Runbook**.
2. Enter a name, unique slug, and optional description.
3. Select an empty, diagnostics, service-recovery, or Kubernetes-recovery template.
4. Create the Runbook. Recovery templates include approval before their restart action;
   they are examples, not production-ready policies for your service.

Use library search and the published/draft filter to find existing workflows.

## Configure ordered steps

In **Builder & Inputs → Builder**, add a step and open **Configure step**.
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
  "steps": [{
    "key": "restart",
    "name": "Restart API",
    "type": "SYSTEMD",
    "riskClass": "NON_IDEMPOTENT",
    "requiresApproval": true,
    "config": { "action": "restart", "unit": "api.service" },
    "precheck": { "steps": [{
      "key": "before", "name": "Inspect API", "type": "SYSTEMD",
      "riskClass": "READ_ONLY", "config": { "action": "status", "unit": "api.service" }
    }] },
    "verification": { "steps": [{
      "key": "after", "name": "Verify API", "type": "SYSTEMD",
      "riskClass": "READ_ONLY", "config": { "action": "status", "unit": "api.service" }
    }] }
  }]
}
```

Before editing JSON, select **Refresh JSON from builder** to include current
builder changes. After editing, select **Apply JSON to builder**, then **Save draft**.
Unapplied JSON displays a warning and disables saving, including after switching tabs.
Refresh discards unapplied JSON edits. Invalid JSON or definitions display an error;
final domain validation occurs when saving.

## Save, publish, and verify

Save the draft and wait for **Changes saved**. Select **Publish draft**, review
the confirmation, and confirm. Only the saved draft is published. Verify the
published version in **Versions** before attaching it to a service. Published
versions are immutable; create a new draft to make further changes.

Continue with [service binding and incident response](./respond).
