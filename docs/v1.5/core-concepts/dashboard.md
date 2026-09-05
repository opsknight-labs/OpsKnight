---
title: Command Center
description: Triage active work, service risk, on-call coverage, and incident trends from the main dashboard
order: 1
---

# Command Center

The Command Center at `/` is the shared operational landing page. It combines current incident pressure with a filtered incident preview, service risk, on-call coverage, SLA warnings, action items, and recent trends.

For user-owned executive or role-specific layouts, use [Reports and Dashboards](./reports-dashboards). For deeper metric definitions and exports, use [Analytics](./analytics).

## Read system status

The top-level status is calculated from active incidents:

| Status      | Condition                                        |
| ----------- | ------------------------------------------------ |
| Critical    | At least one active High-urgency incident        |
| Degraded    | Active incidents exist, but none is High urgency |
| Operational | No active incidents                              |
| Unavailable | The metric calculation failed                    |

“Active” means Triggered (`OPEN`) plus Acknowledged. Snoozed, Suppressed, and Resolved incidents are excluded. Always open the filtered incident list before treating the badge as a full service-health diagnosis.

## Command Center summary

The header summarizes the selected range and current workload, including total incidents, Active work, Muted work, Resolved incidents, unassigned incidents, and High-urgency Active incidents. **Muted** is the current combined count of Snoozed plus Suppressed incidents and shows both values in its breakdown. A retention indicator appears when the requested history is clipped by the installation's retention policy.

Selecting a summary link opens the corresponding incident view. The destination preserves the
card's service, assignee, urgency, strict status, and effective date scope. The Muted link uses the
combined muted filter. A card remains unlinked when the incident list cannot reproduce its value.

Each metric group shows when it was calculated. `N/A` with **Data unavailable** means the query
failed; **No qualifying data** means the query succeeded but the metric has no eligible sample.
Neither state is a measured zero.

## Filter the incident preview

Use quick filters for:

- all incidents;
- incidents assigned to you;
- unassigned Open incidents;
- High, Medium, or Low urgency.

Advanced filters support:

| Filter   | Supported values                                          |
| -------- | --------------------------------------------------------- |
| Search   | Incident text supported by the dashboard query            |
| Service  | One service or all services                               |
| Status   | Open, Acknowledged, Resolved, Snoozed, Suppressed, or all |
| Assignee | One user, unassigned, or all                              |
| Urgency  | High, Medium, Low, or all                                 |
| Range    | Preset range or custom start/end dates                    |
| Sort     | Newest, oldest, status, urgency, or title                 |

The dashboard incident preview is limited to 20 matching records. Open **Incidents** for the full paginated list.

## Ops Pulse

Ops Pulse highlights three current queues:

- **My Queue** — active incidents directly assigned to the signed-in user;
- **Critical Focus** — up to three active High-urgency incidents;
- **Services at Risk** — services with active incidents, including critical counts.

These cards are shortcuts into the underlying incidents and services. They do not replace escalation ownership or a schedule coverage check.

## Smart Insights

The Command Center applies deterministic rules to current incident telemetry and renders compact, single-line operational banners:

- **Critical Spike** (rose tier): Triggered when critical or High-urgency incidents surge, providing a direct **View Critical Feed →** 1-click filter link.
- **Workload Warning** (amber tier): Triggered when unassigned active incidents exceed 30% or more of active workload, offering a **Triage Unassigned →** shortcut.
- **Service Concentration**: Warns when a single service contributes 40% or more of active incident volume.
- **Unusual Volume**: Highlights when current incoming rate exceeds the comparison baseline.
- **All Clear**: Displays a calm green confirmation when all systems are operating normally.

Smart Insights use semantic color tiers (critical red, workload amber, calm emerald) and include dedicated dismiss buttons (`X`) that hide the hint for the current session without modifying underlying incident records.

## Real-time incident alerts and live updates

The Command Center connects to the server-sent events stream (`/api/notifications/stream` and `/api/realtime/stream`) to deliver instantaneous incident awareness without requiring page reloads:

### Real-time alert toasts

When a new incident is created (via integration webhooks such as Datadog, CloudWatch, Prometheus, Sentry, or manual triage), an ultra-compact alert card floats in the top-right corner:

- **Single Incident Card**: Slim footprint (~65px height, max width 380px) with a left priority accent stripe (`P1` rose, `P2` amber, `P3` blue), live pulsing beacon dot, priority pill, affected service name, incident `#ID`, truncated title, inline `View ↗` link, inline `Acknowledge` action (when permitted by role), and a high-contrast dismiss button (`X`).
- **Multi-Incident Batch Alerts**: When multiple incidents trigger concurrently or during multi-service cascade failures, the system consolidates them into a single high-density batch card (`{N} New Incidents`). It displays the top 2 highest-priority incidents with priority badges and service tags, a `+{N} more on board` overflow indicator, a direct `View board ↗` link, and a `Dismiss all` button.
- **Dismiss Behavior**: Clicking the close button (`X`) or `Dismiss all` instantly closes the notification via the centralized Sonner toast manager.

### Optimistic table prepending

Newly detected incidents are immediately prepended to the top of the incident list table with an animated emerald `LIVE` pulse indicator, and active dashboard counters (Command Center, Critical Focus, and Services at Risk) update in real time.

Network interruptions can delay updates; verify a critical change on the incident page or refresh the browser if the dashboard looks stale.

## Export

The Command Center can export its current incident data and summary metrics to CSV in the browser. The file includes the active filters, headline counts, and incident rows loaded by the view. For the richer server-generated export and larger result set, use [Analytics](./analytics#export-csv).

Review exported incident titles, services, and assignees before sharing the file outside the organization.

## Search

The sidebar and mobile experiences also expose application search backed by `/api/search`. Search results are navigational and permission-aware according to the underlying pages. Do not treat search as an audit or export interface.

## Keyboard navigation

Shortcuts are ignored while typing in an input, text area, or editable field.

| Keys          | Action                                                |
| ------------- | ----------------------------------------------------- |
| `?`           | Open shortcut help                                    |
| `G`, then `D` | Dashboard                                             |
| `G`, then `I` | Incidents                                             |
| `G`, then `S` | Services                                              |
| `G`, then `T` | Teams                                                 |
| `G`, then `U` | Users                                                 |
| `G`, then `C` | Schedules                                             |
| `G`, then `P` | Escalation Policies                                   |
| `G`, then `A` | Analytics                                             |
| `C`           | Open Quick Create                                     |
| `N`           | Create an incident when already in the Incidents area |
| `Esc`         | Close a modal or dialog where supported               |

The shortcut overlay in some v1.4 builds also lists Command/Ctrl combinations that are not wired by the global handler. Use the verified shortcuts above until that product inconsistency is fixed.

## Accessibility

The application includes skip links, visible focus handling, semantic controls, and keyboard-accessible dialogs. Use the browser's normal zoom rather than relying on a wall-display mode. Report any control that cannot be reached or identified with a keyboard or screen reader as an accessibility defect.

## Troubleshooting

| Problem                                    | Check                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Counts differ from the incident list       | Match status, urgency, service, assignee, range, and retention scope. The dashboard preview is limited.    |
| A card shows `N/A`                         | Read its state label. Unavailable indicates a query failure; no qualifying data indicates an empty sample. |
| My Queue is empty                          | It shows incidents directly assigned to your user, not every incident owned by your teams or schedules.    |
| Status looks stale                         | Open the incident, verify connectivity to the real-time stream, and refresh.                               |
| Historical range is shorter than requested | Read the retention notice and ask an administrator to review data-retention settings.                      |
| Export omits older matches                 | The Command Center exports rows loaded by its view; use Analytics export for a larger filtered set.        |

## Related guides

- [Incidents](./incidents)
- [Services](./services)
- [Schedules](./schedules)
- [Analytics and SLA](./analytics)
- [Reports and Dashboards](./reports-dashboards)
- [Troubleshooting](../troubleshooting)
