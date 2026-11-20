---
title: Service automation examples and starter templates
description: Adapt starter templates and build customer, account, numeric, boolean, channel-notification, and Runbook context workflows.
type: how-to
product_area: services
audience: [administrator, operator, responder]
verification:
  level: source
  verified_at: 2026-10-30
  evidence:
    - src/components/automation/workspace/templates.ts
    - src/components/automation/AutomationWorkspace.tsx
    - src/components/automation/AutomationRules.tsx
    - src/lib/automation/contract.ts
    - src/lib/automation/compiler.ts
    - src/lib/automation/context/normalize.ts
    - src/lib/automation/observation-sensitivity.ts
    - src/lib/runbooks/automation-binding.ts
    - src/lib/automation/response-context.ts
---

# Service automation examples and starter templates

## Prerequisites

Complete the [initial setup and rollout](./service-automation), prepare sanitized
samples, and identify the active escalation policies and service-owned channel
destinations you intend to use. The recipes below describe configurations to
create in Context and Rules; they are not ready-made provider payload contracts.

1. Choose a recipe and confirm the actual EVENT or PROVIDER extraction path.
2. Create its fields with canonical types and values.
3. Add the enrichment and routing rules in the stated order.
4. Test matching, nonmatching, missing, and unmapped inputs.
5. Publish to Shadow, verify real alert evidence, and review before Live.

## Use a starter template deliberately

Starter templates prepare a draft; they do not publish or enable automation.
Their default route is **Use service default**. Select a different policy or add
channel actions yourself if that is the desired outcome.

The starter templates cover:

- **Route by alert priority**: a routing condition on built-in priority in P1/P2.
- **Route production alerts** and **Route by environment**: an environment choice field mapped from EVENT
  `payload.custom_details.environment`, matching `production`; aliases include
  `prod`/`prd` and `stg`.
- **VIP/customer routing**: a text `customer_tier` field mapped from PROVIDER
  `customer_tier`, matching `enterprise`.
- **Route by AWS account**: a text `aws_account` field mapped from PROVIDER `AWSAccountId`,
  initially matching placeholder account `123456789012`.
- **Start from scratch**: an empty rules list.

Applying a template replaces the draft's rules list with its starter rule (or no
rules for scratch) while retaining existing fields and adding a required field
when absent. Download or otherwise preserve work you want to keep before applying
one to an existing draft. It is not an append-rules operation.

An existing field of the required key but a different type blocks the template.
A compatible environment choice field can gain the production choice, subject
to the 200-choice bound. Reused fields keep their existing mappings and aliases:
inspect those before assuming the starter's sample path will work.

## Route an enterprise customer to a dedicated policy

Create a text field `customer_tier`, case-insensitive, with a mapping to the actual
provider path. For the starter's sample, the provider payload is:

```json
{ "customer_tier": "enterprise" }
```

Add a routing rule with `customer_tier EQ enterprise`, selecting the intended
escalation policy. Put it before a final service-default route. Add a Slack or
Teams notification to that same rule if the dedicated channel also needs the alert.

Verify `Enterprise` recognizes as `enterprise`, a different tier falls through,
and missing data uses default routing. A provider-only field requires a provider
sample in Test; normalized stored-alert replay does not recover the original payload.

## Route a particular AWS account

Keep `aws_account` as text. Account identifiers are identifiers, not quantities;
using a number type changes comparison behavior and can discard leading zeroes.
Map PROVIDER `AWSAccountId` only if that is the actual provider's path; other AWS
integrations can use different envelopes.

Discovery excludes phone-shaped values, which can also exclude a numeric account
identifier. Use the known sender schema to configure the field explicitly; an
absent discovery suggestion is not proof the account is absent from the alert.

Replace the placeholder with your intended canonical account string and select
the correct policy. If this field should only apply to one provider type, restrict
its mapping to that integration type. Verify another account and a missing account
both fall through to the reviewed default route.

## Enrich numeric and boolean context

For a numeric example, declare NUMBER `error_rate` mapped from EVENT
`payload.custom_details.error_rate`. An enrichment rule with `error_rate GTE 5`
can set P1 and add a `high-error-rate` tag. This example assumes your sender reports
percentage units: `5` means 5%, not a fraction of one.

Test numeric `5`, numeric string `"5"`, a lower value, missing data, and `"unknown"`.
Numbers and numeric strings normalize; `"unknown"` is unmapped. Operators compare
numbers directly and do not convert units.

For a boolean example, declare BOOLEAN `customer_impact` from your actual event
path. Use `customer_impact EQ true` as a condition. Boolean true/false and text
`"true"`/`"false"` are recognized; numeric 1 and text `"yes"` are not equivalent
to true. Add an explicit state-check rule if you want missing/unmapped data to
have a separate operational outcome.

Automation conditions within one rule are ANDed. To represent OR across different
field conditions, use separate rules with the desired action, respecting
first-match routing and enrichment overwrite semantics.

## Add channel notification without suppressing responder escalation

Create a routing rule with one responder action and one or more supplemental
channel actions. For example, a production match can use a named escalation policy
and notify the enabled service-owned Slack destination.

Select destination identities from the service configuration; a channel name or
webhook URL is not a destination ID. A destination from another service or a
disabled destination fails dependency validation. Changing a channel does not
change the responder policy, and selecting **No escalation** does not mute the
supplemental channel action.

Verify real provider delivery separately after the controlled Live test. A route
match or successful simulation is not evidence of an externally delivered message.

## Pass context to a Runbook safely

Use a successful Live automation evaluation to capture fields such as
`environment` for a service Runbook binding. The binding references
`automation.environment` using its own condition editor and operator names.
Input and approved-target mappings instead use the unprefixed `contextKey` value
`environment`; do not use the condition field name as a mapping key.
Runbook conditions are a separate contract: their `EXISTS` means a recognized
value. Automation's `IS_SET` also includes unmapped values. Do not substitute one
operator for the other.

Only declared, checksum-verified captured fields are available. Missing and
unmapped values carry no executable scalar value; Shadow, fallback, absent, or
corrupt captured context cannot supply a valid Live response context. A removed
field or incompatible type can make a Runbook condition invalid rather than
silently reinterpret it.

Keep remediation permissions, approval policy, input mappings, and target mappings
in the Runbook binding. A successful routing rule does not grant permission for
unattended writes. Follow [Bind Runbooks and respond](../runbooks/respond) and the
[Runbook reference](../../reference/runbooks) for that separate lifecycle.

## Verify before adopting a recipe

Confirm the exact version, normalization state, matching rule, final priority,
responder route, and any intended channel delivery. Test missing/unmapped fields,
overlapping routes, unexpected types, and a provider sample that differs from the
normalized event. Then follow the [candidate rollout](./service-automation#7-change-rules-while-live)
for later changes.
