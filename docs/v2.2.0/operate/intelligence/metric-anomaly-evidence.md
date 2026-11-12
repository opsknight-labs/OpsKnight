---
title: Add metric anomaly evidence to incidents
description: Attach optional metric queries to a service so the intelligence lane can flag deviations from a seasonal baseline as leads on probable causes and the incident timeline.
type: how-to
product_area: intelligence
audience: [administrator, operator]
reader:
  status: SOURCE_VERIFIED
  task: Create, enable, tune and troubleshoot a per-service metric template for anomaly evidence.
verification:
  level: test
  verified_at: 2026-11-10
  evidence:
    [
      src/lib/intelligence/metric-anomaly,
      src/app/(app)/settings/intelligence/response/metrics,
      tests/unit/intelligence-metric-anomaly.test.ts,
      tests/integration/intelligence/metric-anomaly.test.ts,
      tests/components/incident-metric-anomaly-rendering.test.tsx,
    ]
---

# Metric anomaly evidence

A metric template is a metric query you attach to one service. The intelligence lane runs it on a schedule
through one of your [observability connections](./observability-connections.md), compares the latest values
with the same time of week in previous weeks, and records a finding such as
"p99 latency deviated at 11:30 UTC by 7.3 MAD (rose)". Those findings appear as leads under **Possible
causes** on an incident and as rows on its timeline.

It is **off after upgrade**: there are no templates, and a new template is created disabled. It uses no AI
provider. Nothing here runs when an alert is ingested or a page is sent, and a finding never changes,
mutes or pages anything.

## Before you start

- Intelligence is enabled (**Settings → Intelligence**) and the intelligence lane is running.
- You have the Intelligence manage capability.
- An enabled observability connection that answers metric queries exists: Prometheus-compatible, a
  Grafana data source, Datadog or CloudWatch.
- The connection is usable by the service's team: either the connection is not restricted to teams, or
  its allowed teams include the team that owns the service.

## Create a template

1. Open **Settings → Intelligence → Dependencies & changes → Metric anomaly evidence → Manage metric templates**,
   or go to `/settings/intelligence/response/metrics`.
2. Choose the service and the connection, give the template a name (unique per service) and enter the
   query in the connection's own query language.
3. Leave the defaults or tune them (see the table below).
4. Save, then turn the template on. Creating, changing, enabling and deleting a template is audited.

| Setting        | Default | Range        | Meaning                                                                   |
| -------------- | ------- | ------------ | ------------------------------------------------------------------------- |
| Direction      | Both    | Both/Up/Down | Which deviations count                                                    |
| Threshold      | 5 MAD   | 2 to 50      | How far from the usual value, in robust standard units                    |
| Baseline weeks | 4       | 2 to 8       | How many previous weeks form the baseline                                 |
| Window         | 60 min  | 15 to 360    | How much recent data each evaluation looks at                             |
| Step           | 60 s    | 15 to 3600   | Sampling interval; it must fit at least four times into the window        |
| Interval       | 15 min  | 5 to 1440    | How often the template is evaluated                                       |
| Min deviation  | 0       | 0 or more    | Absolute change below which nothing counts (a counter moving from 0 to 1) |

Limits: 10 templates per service and 500 in total; the first 10 series of a query are evaluated, 2,000
points per series are read, and the 10 strongest deviations of one evaluation are kept.

## How a deviation is decided

For each sample in the window, the baseline is every value at the same time of week (plus one step on
either side) in each baseline week. The usual value is the median of those; the spread is the median
absolute deviation (MAD). A sample deviates when

```
|value - median| / max(1.4826 × MAD, 1% of |median|) >= threshold
```

and the difference is at least the minimum deviation. Two samples in a row in the same direction are
required, so a single blip is ignored. Because the baseline follows the weekly shape, a daily or weekly
cycle is not flagged; because it uses medians, an outage in one of the baseline weeks does not distort it.
A flat metric that stays flat is never flagged. A sample with fewer than three baseline values is not
judged, so a new metric produces nothing until it has history.

## Where the evidence appears

- **Possible causes** on the incident: anomalies on the incident's service or a service it depends on that
  started within six hours before the incident opened, or up to ten minutes after. Closer, stronger and
  same-service deviations rank higher. The confidence is capped below certainty: a metric that moved is a
  place to look, not a proven cause.
- **Incident timeline**: one "Metric anomaly" row per deviation, relative to when the incident opened.

People only see anomalies on services they may read. An anomaly on an upstream service the viewer cannot
read is hidden.

## Status and troubleshooting

Each template shows when it was last evaluated and with what result.

| Status                                                | What to do                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Not evaluated yet                                     | Wait one interval; check that the template and Intelligence are on |
| Evaluated                                             | Nothing; anomalies are recorded when found                         |
| The query returned no data                            | Check the query in your metrics tool                               |
| Not enough history yet for a baseline                 | The metric has no data at this time of week in earlier weeks; wait |
| The connection was removed                            | Edit the template and choose another connection                    |
| The connection is disabled                            | Enable the connection                                              |
| The connection is not allowed for this service's team | Add the team to the connection, or choose another connection       |
| The connection cannot answer metric queries           | Choose a Prometheus-compatible, Grafana, Datadog or CloudWatch one |
| The connection did not answer                         | Test the connection; the next interval tries again                 |

When a connection fails or times out, no evidence is recorded for that interval and incidents are analysed
without it. Nothing is retried in a loop and nothing else is affected.

The counter `opsknight_intelligence_metric_evaluations_total{status}` counts evaluations by result.

## Data and retention

Only numbers are stored: the time, direction and size of the deviation, the usual value and the series
labels. Raw series are not stored. Anomalies are deleted with the finding retention period, and with their
template or service. To stop everything, turn the template off or delete it.
