---
order: 6
title: Incident metric contract
description: Canonical vocabulary, scopes, data states, drill-down rules, and trend semantics for incident statistics.
---

# Incident metric contract

All product surfaces must use `src/lib/metric-contract.ts` for shared incident-statistic names,
formulas, scope labels, and trend direction. A metric keeps the same meaning on the Command
Center, Analytics, mobile views, Reports, APIs, and CSV exports.

## Scope rules

- **Current** measures the live backlog and has no historical creation-date cutoff.
- **Selected period** measures the incident cohort created inside the effective reporting window.
- **Last 24h** is a trailing timestamp window, such as incidents whose `resolvedAt` occurred in
  the previous 24 hours.
- **Next 14d** is a forecast window used for schedule coverage.

Current and selected-period values must not be substituted for one another. In particular,
rollup-backed queries retain selected-period urgency totals while a separate current snapshot
supplies Active, Triggered, Acknowledged, Muted, Unassigned, and High-urgency Active values.

## Vocabulary and formulas

- **Triggered** is the user-facing name for strict database state `OPEN`.
- **Active** is `OPEN + ACKNOWLEDGED`.
- **Muted** is `SNOOZED + SUPPRESSED` and is never Active.
- **Total** is the number created inside the selected period.
- **Resolved** is the selected-period creation cohort whose current state is `RESOLVED`.
- **Unassigned Active** is current Active work with no assignee.
- **High-urgency Active** is current Active work with urgency `HIGH`.

MTTA, MTTR, acknowledgement/resolution rates, and SLA compliance use the formulas documented in
the shared registry. Product copy and exports should include the scope when a reader might confuse
a current snapshot with a historical cohort.

## Data states

A numeric zero is valid only after a successful calculation. Surfaces distinguish:

- `available`: the calculation succeeded, including a legitimate zero;
- `no_data`: the calculation succeeded but no qualifying sample exists;
- `partial`: only part of the requested result is available;
- `stale`: the last known result is shown but freshness is outside its contract;
- `unavailable`: the calculation failed and the value must display as `N/A`, never zero.

User-facing metric groups show their calculation time. A real-time stream outage warns that live
updates are paused without replacing the last successfully calculated server result.

## Drill-down contract

A metric is linked only when the destination can reproduce its value. Links preserve applicable
team, service, assignee, urgency, strict status, and effective date boundaries. Current metrics do
not inherit selected-period date limits. Selected-period links use the retention-clipped effective
dates, not merely the requested preset label. Metrics without an exact underlying row set, such as
averages and rates, remain unlinked until a purpose-built detail view exists.

## Trend semantics

Trend arrows describe numerical movement; color describes whether that movement is favorable.
Higher incident volume, MTTA, and MTTR are unfavorable. Higher acknowledgement rate, resolution
rate, SLA compliance, and on-call coverage are favorable. Context-only metrics do not receive an
automatic good/bad interpretation.

## Validation requirements

Changes to statistics must test shared field-to-definition mappings, zero versus unavailable/no
data behavior, live/rollup scope parity, exact drill-down filters, API/export metadata, and the
direction used to color comparisons.
