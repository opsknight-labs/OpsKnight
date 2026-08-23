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
6. If a target is invalid or resolves to no users, the timeline records the failure and OpsKnight advances to the next step. After the last step, escalation is complete.

Delays mean “wait before this step,” not “wait after the previous notification.” A zero delay executes the step immediately.

Policies do not repeat in v1.4. After the last step is exhausted, the escalation is complete.

## Target types

| Target       | Resolution behavior                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **User**     | Contacts the selected user directly.                                                                                               |
| **Team**     | Contacts members whose team-notification participation is enabled. Existing lead-only steps contact the configured Team Lead only. |
| **Schedule** | Contacts the effective user or users on call at execution time after layer priority and overrides are applied.                     |

For a Team target, service ownership is not required. For a Schedule target, an empty coverage window resolves to no users; OpsKnight does not notify the entire schedule roster as a fallback.

## Create a policy

1. Open **Escalation Policies** and select **Create Policy**.
2. Enter a unique name and a description that states when the policy should be used.
3. Create the empty policy.
4. Open it and add ordered steps.
5. For each step, select User, Team, or Schedule and set a non-negative delay.
6. Drag or move steps into final order.
7. Attach the policy from **Service → Settings**.

The policy can be saved with no steps, but it cannot page anyone until at least one valid step exists.

### Channel behavior in the v1.4 interface

New steps created in the current v1.4 policy interface do not expose a per-step channel selector. They use each resolved user's enabled notification preferences and the configured workspace providers. Although the data model supports stored step-channel overrides, do not depend on an undocumented database-level configuration as a public workflow.

Likewise, the current add-step interface does not expose the Team Lead-only toggle. Existing lead-only steps can execute and are labeled in the policy view, but new policy design should not depend on setting that flag through the v1.4 UI.

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
- avoid disabled users and empty teams;
- monitor schedule end dates and coverage gaps;
- ensure each target has at least one configured delivery channel;
- use descriptions that distinguish critical and non-critical paths;
- retest after membership, schedule, provider, or policy changes.

## Reorder and edit safely

The interface supports adding, deleting, and reordering steps. Reordering preserves the delay associated with each position in the sequence rather than moving delay semantics blindly with a person. Review every displayed delay after reordering.

Policy changes can affect active incidents because escalation reads the service's current policy as it advances. Before a production edit:

1. Review currently escalating incidents.
2. Record the original order and timing.
3. Apply the smallest change.
4. Reopen the policy and confirm target order and delays.
5. Run a test incident through at least two steps.

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
7. Resolve and remove test artifacts according to retention policy.

## Troubleshooting

### Escalation does not start

Confirm the service has this policy, the incident is Open, the policy has steps, and the incident escalation state is not already completed or paused.

### A step resolves to no users

- User: confirm the account exists and is active.
- Team: confirm eligible members have team notifications enabled; for a lead-only legacy step, configure a Team Lead and enable their team notifications.
- Schedule: inspect effective coverage at the execution time, including timezone, restrictions, gaps, priority, and overrides.

OpsKnight records the problem in the incident timeline and advances when another step exists.

### A target is correct but receives no message

Check the user's notification preferences, contact/device data, provider settings, notification history, and system logs. A policy target is not proof that a delivery provider accepted the message.

### Later steps continue after response

Confirm the incident was actually acknowledged or resolved and inspect its escalation status and timeline. Assignment alone does not acknowledge an incident.

## Related topics

- [Services](services.md)
- [On-call schedules](schedules.md)
- [Teams](teams.md)
- [Users](users.md)
- [Incident management](incidents.md)
- [Troubleshooting](../troubleshooting.md)
