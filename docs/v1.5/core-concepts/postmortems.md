---
title: Postmortems
description: Document resolved incidents and turn lessons into owned corrective work
order: 11
---

# Postmortems

OpsKnight postmortems capture what happened, the impact, why it happened, how service was restored, what the team learned, and which corrective actions have owners. A postmortem belongs to exactly one resolved incident, and an incident can have at most one postmortem.

## Permissions and lifecycle

- Any authenticated user can view the Postmortems list.
- Responders and administrators can create, edit, publish, archive, and delete postmortems.
- A postmortem can be created only for an incident whose status is **Resolved**.
- The supported statuses are **Draft**, **Published**, and **Archived**.
- **Public Visibility Control**: Responders can toggle **Publish to Status Page** with one click.
- **Customer Preview Mode**: Responders can preview the customer-redacted view (anonymized responder names, internal SLA details hidden) directly from the postmortem studio without logging out.

## Choose incidents that need a review

OpsKnight does not force a postmortem policy. Define one for your organization. Strong candidates include customer-impacting incidents, security or data events, missed SLA targets, repeated failure modes, long incidents, difficult handoffs, and useful near misses.

Do not use the postmortem to assign blame. Describe system conditions, signals, decisions, constraints, and opportunities for improvement.

## Create a postmortem

1. Resolve the incident.
2. Open **Postmortems**.
3. Select **Create Postmortem**.
4. Choose one of the most recent resolved incidents without a postmortem.
5. Enter a title (maximum 100 characters).
6. Complete the relevant sections described below.
7. Leave the status as **Draft** while the content is being reviewed.
8. Save, reopen the postmortem, and check the rendered result.

You can also create or open a postmortem from its incident page when that action is available.

## Fields and sections

| Section                 | What to record                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Title                   | A short identifier for this incident review                                                                                                |
| Executive Summary       | What happened, impact, duration, and restoration in plain language                                                                         |
| Timeline                | Detection, escalation, mitigation, and resolution events with timestamps, titles, descriptions, and optional actors                        |
| Impact                  | Users affected, downtime, error rate, services affected, SLA breaches, revenue impact, API errors, and performance degradation             |
| 5-Whys Root Cause Chain | Step-by-step sequential causal diagram (Problem ➔ Why #1 ➔ Why #2 ➔ ... ➔ Root Cause Finding)                                              |
| Contributing Factors    | Standardized tags: `Infrastructure`, `Code Defect`, `Process / Runbook`, `Human Factor`, `Vendor`, `Monitoring Gap`, `Configuration Drift` |
| Resolution              | What restored service and how recovery was verified                                                                                        |
| Action Items            | Corrective work with owner, smart due date countdown, priority, and one-click status transitions                                           |
| Lessons Learned         | What helped, what hindered, and what should change for future resiliency                                                                   |
| Status                  | Draft, Published, or Archived                                                                                                              |
| Visibility & Preview    | Public on Status Page toggle with interactive Customer Preview Mode                                                                        |

## 5-Whys Root Cause Analysis

The interactive 5-Whys builder helps teams uncover the underlying systemic cause rather than stopping at surface symptoms:

1. Each step documents a specific question and answer.
2. The final step highlights the identified **Root Cause Finding**.
3. Visual node connectors illustrate the unbroken causal chain.

## Contributing Factors Taxonomy

Tagging contributing factors enables pattern discovery across incident retrospectives:

- **Infrastructure**: Network partition, host exhaustion, cloud provider degradation.
- **Code Defect**: Unhandled exception, query regression, missing test coverage.
- **Process / Runbook**: Outdated documentation, ambiguous handoff procedure.
- **Human Factor**: Alert fatigue, manual typo during emergency maintenance.
- **Third-Party Vendor**: External API downtime, webhook delivery failure.
- **Monitoring Gap**: Silent failure, delayed alert trigger, telemetry blindspot.
- **Configuration Drift**: Missing environment variable, mismatched deployment flags.

## Track corrective actions

Each action item supports:

- title and description;
- one active-user owner or no owner;
- smart due date countdown badge;
- High, Medium, or Low priority;
- Open, In Progress, Completed, or Blocked status;
- an optional Jira / GitHub issue link.

The postmortem shows completion progress and marks past-due, incomplete items as overdue. The main **Action Items** page provides the organization-wide board and filters. See [Action Items](./action-items).

## Publish or archive

Before setting **Published**:

1. Confirm the incident is the correct one.
2. Verify the summary, timeline, impact, 5-whys, and resolution.
3. Give each required action item an accountable owner and realistic due date.
4. Use **Preview Customer View** to verify that internal notes or credentials are not exposed.
5. Toggle **Publish to Status Page** if appropriate for customer transparency.

## Related guides

- [Incidents](./incidents)
- [Action Items](./action-items)
- [Status Page](./status-page)
- [Jira Cloud](../integrations/issue-tracking/jira)
- [Analytics](./analytics)
