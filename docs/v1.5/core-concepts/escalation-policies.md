---
title: Escalation policies
description: Define ordered paging steps for users, teams, and current on-call responders.
order: 6
---

# Escalation policies

An escalation policy defines who OpsKnight contacts, in what order, and how long it waits before each step. A policy runs only when it is attached to the incident's service.

Only an application **Admin** can create, change, reorder, or delete policies and their steps. Responders can see policy and escalation state but cannot administer it.

## How execution works

1. A new Open incident starts the service's policy.
2. OpsKnight waits for the first step's delay, if any.
3. It resolves the step target to one or more users, assigns an unassigned incident to the target, and sends notifications.
4. It schedules the next step using that next step's delay.
5. Acknowledging, resolving, snoozing, or suppressing the incident stops or pauses further escalation according to the incident lifecycle.
6. If a target is invalid or resolves to no users, the timeline records the failure and OpsKnight advances when another step exists. If the final step cannot resolve a valid recipient, the escalation ends in `FAILED` rather than being reported as successfully completed.

Delays mean “wait before this step,” not “wait after the previous notification.” A zero delay executes the step immediately.

Policies do not repeat in v1.5. A policy that executes through its valid steps can finish as completed; terminal routing failures remain failed so operators can distinguish exhaustion from successful execution.

A step's outcome is recorded in a single transaction: the assignment, the responder pages, the timeline entries, the next step's due time, and the work that will run it. A step therefore cannot advance past a page that was never recorded, and cannot leave a due step with nothing scheduled to run it. Delivery to email, SMS, push, or Slack happens after that point, so a provider outage delays a page rather than stopping escalation.

Escalation state is recorded when the incident is created, so an open incident on a service with a policy always has a due step. If the work that runs it is ever lost, OpsKnight recreates it from the incident's own state.

## Target types

| Target       | Resolution behavior                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **User**     | Contacts the selected user directly.                                                                                                      |
| **Team**     | Contacts active members whose team-notification participation is enabled. Existing lead-only steps contact the configured Team Lead only. |
| **Schedule** | Contacts the effective active users on call at execution time after layer priority and overrides are applied.                             |

For a Team target, service ownership is not required. For a Schedule target, an empty coverage window resolves to no users; OpsKnight does not notify the entire schedule roster as a fallback.

### Responder eligibility

Only accounts with status **Active** are paged or made an incident's owner. An invited account that has not finished onboarding, and a disabled account, are both ineligible — so a step that points only at such an account reaches nobody, exactly as if the target were missing.

This applies everywhere a responder is chosen:

- a User step whose account is inactive is an unusable target, not an empty one, and the timeline says so;
- a Team step contacts only its active members, and a lead-only step whose Team Lead is ineligible pages nobody rather than widening to the whole team;
- a Schedule step contacts only active users in the effective coverage; and
- an incident cannot be newly assigned to an inactive account.

A database problem while resolving a target is retried. It is never reported as "no responders available", because those two situations need opposite responses.

## Create a policy

1. Open **Escalation Policies** and select **Create Policy**.
2. Enter a unique name and a description that states when the policy should be used.
3. Create the empty policy.
4. Open it and add ordered steps.
5. For each step, select User, Team, or Schedule and set a delay between 0 and 10080 minutes (7 days). A delay that is not a whole number of minutes, is negative, or exceeds that bound is rejected with the reason.
6. Drag or move steps into final order.
7. Attach the policy to a service from **Service → Settings** or view the full ladder directly in the service's **Escalation Policy** tab.

The policy can be saved with no steps, but it cannot page anyone until at least one valid step exists.

### Channel behavior

New steps created in the policy interface use each resolved user's enabled notification preferences and the configured workspace providers. Although the data model supports stored step-channel overrides, do not depend on an undocumented database-level configuration as a public workflow.

Personal Quiet Hours is a separate recipient policy. It is off by default and must be explicitly enabled by the user. When active, it can suppress LOW-urgency Push, SMS, and WhatsApp delivery for that recipient; Email and in-app remain available, and MEDIUM/HIGH urgency bypasses Quiet Hours. Fallback does not reintroduce a channel that Quiet Hours intentionally suppressed.

## Design a resilient policy

A typical production sequence is:

| Step | Target                        |         Delay | Purpose                                       |
| ---- | ----------------------------- | ------------: | --------------------------------------------- |
| 1    | Primary on-call schedule      |     0 minutes | Immediate accountable responder.              |
| 2    | Backup schedule or team       |  5–10 minutes | Coverage for a missed page or schedule gap.   |
| 3    | Incident commander or manager | 10–20 minutes | Human escalation when response has not begun. |

Choose timing based on actual acknowledgement objectives and provider latency. Avoid multiple immediate steps unless parallel paging is intentional.

For every policy:

- include a final target that is maintained and likely to resolve;
- avoid inactive accounts and empty teams; only active accounts are eligible, so an invited-but-not-onboarded member never pages;
- monitor schedule end dates and coverage gaps;
- ensure each target has at least one configured delivery channel;
- use descriptions that distinguish critical and non-critical paths;
- verify urgency mapping is appropriate for alerts that must always page regardless of personal Quiet Hours; and
- retest after membership, schedule, provider, or policy changes.

## Reorder and edit safely

The interface supports adding, deleting, and reordering steps. Reordering preserves the delay associated with each position in the sequence rather than moving delay semantics blindly with a person. Review every displayed delay after reordering.

Policy changes can affect active incidents because escalation reads the service's current policy as it advances. Before a production edit:

1. Review currently escalating incidents.
2. Record the original order and timing.
3. Apply the smallest change.
4. Reopen the policy and confirm target order and delays.
5. Run a test incident through at least two steps.

## Manual escalation

An operator can advance an open incident's escalation without waiting for its next step. Because this pages other responders, it is permission-checked against that specific incident rather than being available to anyone signed in: Responders and Admins can escalate any incident, and a standard User can escalate one they are responsible for through assignment, their team, the service's owning team, or a watch. Every manual escalation is recorded in the incident timeline and the audit log with the actor and the surface it came from.

An incident that is no longer open cannot be manually escalated; there is no later tier to page. See [Authorization and Roles](../security/authorization) for the full matrix.

## Attach, replace, or remove a policy

Open **Service → Settings → Ownership & Escalation**. Select a policy, save, and trigger a test incident.

Selecting no policy leaves the service in manual-paging mode. Before replacement or removal, check active incidents and ensure operators know how those incidents will be handled.

A policy cannot be deleted while any service uses it. Reassign or remove it from every listed service first.

## Test the policy

Use a non-production service or coordinated test window:

1. Create an Open test incident through the real integration path.
2. Confirm the timeline records the initial scheduled or executed step.
3. Verify the expected user receives a notification through their enabled channel.
4. Allow the next step to execute and verify its target and timing.
5. Acknowledge and confirm no later step runs.
6. Repeat during a schedule override and a known coverage edge.
7. For a LOW-urgency test, explicitly verify Quiet Hours behavior only on a user who chose to enable it.
8. Resolve and remove test artifacts according to retention policy.

## Troubleshooting

### Escalation does not start

Confirm the service has this policy, the incident is Open, the policy has steps, and the incident escalation state is not already completed, failed, or paused.

### A step resolves to no users

- User: confirm the account exists and is active.
- Team: confirm eligible members have team notifications enabled; for a lead-only legacy step, configure a Team Lead and enable their team notifications.
- Schedule: inspect effective coverage at the execution time, including timezone, restrictions, gaps, priority, and overrides.

OpsKnight records the problem in the incident timeline and advances when another step exists. The timeline distinguishes an unusable target — a deleted or inactive user, a removed team or schedule, a step with no target selected — from a target that resolved to no eligible responders, because the two need different fixes.

If the final step has an unusable target or no eligible users, the terminal escalation state remains `FAILED` so the routing problem is visible instead of being mislabeled `COMPLETED`. A manually assigned owner already on the incident is paged alongside the first step's target, but never counts as that step reaching someone: a step whose target covered nobody is reported as such even when the incident has an owner.

### A target is correct but receives no message

Check the user's notification preferences, contact/device data, Quiet Hours state for LOW urgency, provider settings, notification history, and system logs. A policy target is not proof that a delivery provider accepted the message.

### Later steps continue after response

Confirm the incident was actually acknowledged or resolved and inspect its escalation status and timeline. Assignment alone does not acknowledge an incident.

## Related topics

- [Services](services.md)
- [On-call schedules](schedules.md)
- [Teams](teams.md)
- [Users](users.md)
- [Incident management](incidents.md)
- [Troubleshooting](../troubleshooting.md)
