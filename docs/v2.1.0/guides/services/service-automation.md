---
title: Configure and roll out service automation
description: Build context fields and rules, test alerts, publish safely, review Shadow results, and recover from routing mistakes.
type: how-to
product_area: services
audience: [administrator, responder, operator]
verification:
  level: source
  verified_at: 2026-10-30
  evidence:
    - src/components/automation/workspace/constants.ts
    - src/components/automation/workspace/useAutomationDraft.ts
    - src/components/automation/workspace/RemoveFieldDialog.tsx
    - src/app/(app)/services/[id]/automation/actions.ts
    - src/app/(mobile)/m/services/[id]/automation/page.tsx
    - src/components/automation/AutomationReviewDialog.tsx
    - src/lib/automation/versioning.ts
    - src/lib/automation/readiness.ts
    - src/lib/automation/readiness-policy.ts
    - tests/e2e/automation.spec.ts
    - tests/integration/automation-readiness-policy.test.ts
---

# Configure and roll out service automation

Use this guide to introduce alert enrichment and routing on one service, then
change it safely while Live. Read the [concept](../../concepts/service-automation)
first if you are unfamiliar with context fields or Shadow mode.

## Prerequisites

- A service with a known owner, a working inbound integration, and an intentional
  default escalation policy.
- An administrator for global settings, publication, and mode changes. A responder
  on the owning team can prepare the draft.
- Representative sanitized alerts, including missing and unexpected values.
- Working background workers for observation aggregates and supplemental delivery.
- Enabled service-owned Slack or Teams destinations if rules will notify channels.

Test ordinary ingestion and default paging before introducing automation. A rule
that selects the service default cannot repair a broken escalation policy.

## 1. Prepare the workspace

1. Open **Services**, select the service, and open **Automation**.
2. Inspect **Overview** for the current mode, published version, health, and
   configuration problems.
3. Have an administrator enable **Enable service automation globally** in system
   settings. Leave the service Disabled while authoring.
4. Use **Context**, **Rules**, and **Test** to prepare the draft. **Activity** holds
   published history and restoration controls.

Edits autosave after a short delay. Wait for **Saved** before leaving the workspace;
**Unsaved**, **Offline**, and **Save failed — retry** do not confirm server persistence.
The browser keeps a recovery copy scoped to your account and service when browser
storage is available. A local recovery copy is not a published version.

If another operator saves concurrently, publication pauses. Select **Review
conflict**, compare both copies, then deliberately choose **Keep my copy as a new
draft revision** or **Reload their changes**. **Download my copy** preserves your
local snapshot before reconciliation. Keeping your copy replaces the server draft
with that reviewed copy; it does not automatically merge both operators' edits.

## 2. Normalize environment labels

This example routes production alerts normally and suppresses responder escalation
only for explicitly recognized staging and development alerts.

1. In **Context**, create a choice field with key `environment` and label
   `Environment`.
2. Add canonical choices `production`, `staging`, and `development`.
3. Keep matching case-insensitive. Add aliases `prod` and `prd` → `production`,
   and `stg` → `staging`.
4. For an Events API alert, add an EVENT mapping to
   `payload.custom_details.environment`.
5. For another provider, inspect its sanitized payload and add a PROVIDER mapping
   to its actual environment path, optionally restricted to that integration type.

Mappings are tried in order. The first non-null, nonblank value is selected; a
later mapping does not repair an earlier value that turns out to be unmapped.
Do not extract whole objects or arrays into scalar fields.

### Discover fields and replay stored alerts

You can inspect a sanitized pasted sample or use recent alert discovery to identify
paths before adding fields. Recent alert discovery requires sensitive incident
access and inspects at most 20 recent stored alerts. Discovery suggestions are
candidates for authoring, not automatically active fields or rules.

Stored-alert tests replay normalized event data only: the original provider payload
is unavailable. Provider-only mappings cannot be fully verified by that replay;
supply a representative provider sample separately. Verify the integration type
and selected service-owned integration so classification matches the intended source.

Persisted discovery previews are a separate administrator opt-in. Without retained
readable previews, use a known sanitized sample to author aliases. Do not enable
preview retention solely to make a rule match.

## 3. Add enrichment and routing rules

In **Rules**, add these rules:

1. An enrichment rule named `Production priority`: when `environment` equals
   `production`, set priority to `P1` and add tag `production`.
2. A routing rule named `Known non-production`: when `environment` is in
   `[staging, development]`, select **No escalation**.
3. A final routing rule named `Default response`: no conditions, use the service
   default escalation policy.

For a separate production response team, replace the last rule with a specific
production match selecting that team's escalation policy, followed by the default
catch-all. Select a policy that is active and has valid responder targets.

The compiler prohibits an enabled unconditional **No escalation** route. Keep
suppression conditional on explicitly recognized data. Priority changes do not
change urgency: there is no automation action to set urgency.

Review ordering and compiler warnings. Multiple priority writers can overwrite
each other, and an early catch-all hides every later routing rule. A supplemental
Slack/Teams notification belongs to a routing rule and uses an enabled destination
owned by this service.

## 4. Test the draft without sending notifications

In **Test**, select the intended integration context and use a sanitized normalized
event such as:

```json
{
  "event_action": "trigger",
  "dedup_key": "automation-production-example",
  "payload": {
    "summary": "Synthetic production alert",
    "source": "automation-test",
    "severity": "error",
    "custom_details": { "environment": "prd" }
  }
}
```

Supply the provider payload separately when testing PROVIDER mappings. Running a
sample evaluates the current draft without creating incidents or notifications.
Inspect extraction, condition results, enrichment, and the selected route.

Repeat these cases and confirm the expected results:

- `prd`: recognized as production; final priority P1; default response route.
- `stg`: recognized as staging; no responder escalation.
- Missing environment: the non-production rule does not match; default response.
- Unknown value such as `preview-42`: unmapped; default response.
- Several conditions together: all must be true for the rule to match.
- Overlapping rules: only the first matching routing rule wins.

Also test provider-specific mappings and any numeric/boolean fields. Successful
simulation does not prove actual destination delivery or waive activation checks.

## 5. Publish, then observe in Shadow

1. Save the draft and resolve blocking validation issues.
2. Review the publication diff, policy references, and channel destinations.
3. Have an administrator publish the version. Record its number.
4. Set the service to **Shadow**.
5. Send representative alerts through the real integration. Use unique deduplication
   keys so each creates a new test incident.
6. Review **Overview**, recent evaluations, and incident automation diagnostics.
   Compare proposed priority, escalation route, no-escalation outcomes, errors,
   and fallbacks against actual ordinary behavior.
7. Confirm observation workers are processing queued work before judging counts.

Expected result: incidents still use ordinary priority and routing; Shadow
collects comparison evidence without applying the proposed actions. Choose alert
sources and scenarios that represent production, rather than treating a high
count of identical alerts as sufficient confidence.

## 6. Enable Live

Have an administrator review the published version and switch to **Live**. Every
mode change to Live checks dependencies and asks for explicit acknowledgement
if that version has no recent Shadow evaluations or recorded errors/fallbacks.
These checks also apply when re-enabling a previously Live service after
Disabled or Shadow. The candidate readiness thresholds below are a separate
promotion contract.

Send one controlled production case and one non-production case. Verify:

- The production incident has the expected priority, tags, and pinned route.
- Its SLA contract reflects the final priority at creation.
- The non-production incident exists but has intentional no-escalation behavior.
- Intended channel notifications are delivered through their provider pipeline.
- Missing/unmapped context keeps the intended default response.

Check other service notifications separately; **No escalation** is not a global
mute. Preserve the reviewed version number and audit history for the change.

## 7. Change rules while Live

1. Edit and test the draft, then publish it.
2. Confirm publication created a **candidate** and the prior active version still
   routes incidents.
3. Allow new traffic to evaluate the candidate in Shadow against actual Live results.
4. Review routing, priority, and suppression differences and any fallback/error counts.
5. Review candidate readiness. Defaults require at least 100 evaluations in the
   seven-day evidence window, a latest daily bucket no older than 48 hours, no
   pending/processing candidate observations, and an error rate of zero.
6. Activate the reviewed candidate as an administrator. Promotion swaps the active
   version and clears the candidate atomically.

Administrators can configure readiness policy and deliberately acknowledge
insufficient/stale evidence, errors above policy, or material differences.
An observation backlog above policy remains blocking even when those exceptions
are acknowledged. Freshness is based on daily aggregate buckets, not exact event
arrival timestamps. Record the reason for any exception; counts do not establish
workload representativeness.

If the candidate is wrong, discard it. This leaves the active Live version alone.
If publishing another version while a candidate already exists, review that
replacement explicitly; the expected candidate identity protects against silently
replacing a candidate another operator has just changed.

## Recover or stop automation

For one service, select **Disabled** to stop evaluating automation for newly
accepted work. Already accepted work may carry its original mode/version pointers;
use the global switch for an emergency stop that also fences enabled backlog.

For a global incident, save global OFF in system settings. This resets service
modes to Disabled. Re-enabling global automation requires deliberate service-by-service
activation; it does not restore previous Live modes automatically.

To recover an earlier configuration, open **Activity**, compare versions, and
restore the desired version to the draft. Review, test, and publish it. If still
Live, this creates another candidate and requires promotion. Historical restore
alone does not roll production back, and existing incidents retain their captured
decisions.

## Maintain fields and use mobile

Keep field keys stable when other rules or Runbook triggers depend on them.
The UI blocks removal while draft rules still reference a field. Update affected
conditions and context writes first, then remove it; the removal affects the draft,
and the UI offers a short undo window. Mark an intentionally unused field as
**Display only** to avoid the unused-field warning. This flag does not disable
extraction or change matching semantics.

On mobile, open a service and select **View automation** to use the same workspace
at `/m/services/{id}/automation`. Reading, editing, publication, and sensitive sample
access still follow the same permissions; a smaller screen grants no extra access.

For a complete scripted setup, see [Author and operate automation through the API](./service-automation-api).

## Continue with examples and operations

- [Starter templates and worked examples](./service-automation-examples): priority,
  customer/account routing, numeric/boolean fields, channels, and Runbook context.
- [Production operations](../../operate/reliability/service-automation): comparison
  counters, readiness policy, discovery bounds, privacy cleanup, and recovery.
- [Troubleshooting](../../troubleshooting/service-automation): symptom-by-symptom
  diagnosis and expected recovery checks.
- [Every supported v2 endpoint](../../reference/service-automation#complete-v2-endpoint-checklist).

## Common problems

- **Rule never matches:** check EVENT versus PROVIDER, mapping order, integration
  filter, canonical values, and Missing/Unmapped states.
- **A later route never runs:** move an unconditional or broader earlier rule, or
  narrow its conditions.
- **Publish fails:** repair missing/archived policies, unsafe targets, invalid
  fields, or disabled/cross-service destinations.
- **Counts lag:** inspect observation worker health and pending work; ingestion
  acceptance and background evidence processing are separate.
- **Live uses the old rule:** check for a candidate that has not been activated,
  or an incident/queued event pinned before publication.
- **A disabled rule still causes validation errors:** disabled rules remain part
  of the snapshot and are validated; fix or remove invalid configuration.

See the [reference and diagnostic checklist](../../reference/service-automation)
and [API lifecycle contract](../../reference/api/v2#service-automation-drafts-and-publication).
