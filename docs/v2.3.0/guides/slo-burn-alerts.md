---
title: Alert on SLO burn rate
description: Page or open a ticket-urgency incident when an availability objective spends its error budget too fast, measured from good and total event counts in your metrics backend.
type: how-to
product_area: services
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Set up, test, enable and watch a multi-window burn-rate alert for one availability or uptime objective.
verification:
  level: source
  verified_at: 2026-11-21
  evidence:
    - src/lib/slo/burn-alerts/contract.ts
    - src/lib/slo/burn-alerts/tiers.ts
    - src/lib/slo/burn-alerts/evaluate.ts
    - src/lib/slo/burn-alerts/service.ts
    - src/components/settings/SloAlertingStep.tsx
    - src/components/service/intelligence/SloBurnChart.tsx
    - src/app/api/v2/service-objectives/[id]/alert-policy/route.ts
    - src/app/api/v2/service-objectives/[id]/burn-history/route.ts
    - prisma/migrations/20261121200000_slo_burn_alerts/migration.sql
    - tests/unit/slo-burn-alert-tiers.test.ts
    - tests/integration/slo-burn-alerts.test.ts
---

# Alert on SLO burn rate

New in 2.3.0. A burn-rate alert watches one availability or uptime objective and raises an incident when
the error budget is being spent much faster than the objective allows. It measures real traffic: two
queries against a metrics connection count the good events and the total events in each 5-minute step.

Burn-rate alerts are off until you enable them, per objective.

## How it decides

Burn is how fast the budget is spent: `(1 − good ÷ total) ÷ (1 − target)`. At 1× the budget lasts exactly
the objective's window; at 14.4× a 30-day budget is gone in about two days.

Each tier checks a long window and a short window. It fires only when **both** burn at or above its
threshold, so an outage that has already stopped does not keep alerting.

| Tier   | Long window | Short window | Threshold | Incident severity |
| ------ | ----------- | ------------ | --------- | ----------------- |
| Page   | 1 hour      | 5 minutes    | 14.4×     | critical          |
| Page   | 6 hours     | 30 minutes   | 6×        | critical          |
| Ticket | 1 day       | 2 hours      | 3×        | warning           |
| Ticket | 3 days      | 6 hours      | 1×        | warning           |

- **Coverage**: a tier arms only once stored measurements span its long window. The first evaluation
  backfills up to three days, so with existing data every tier is armed at once.
- **No traffic**: a window without any events has no burn and cannot fire.
- **Escalation is immediate**: a ticket that becomes a page raises the urgency of the **same** incident (one
  dedup key per objective, `slo:<objective id>`), it does not open a second one.
- **Stepping down waits**: the state steps down only after three clean evaluations in a row (15 minutes).
  The incident is resolved only when the state reaches OK.
- Alerts go through the normal event path, so routing, escalation, maintenance windows and noise
  controls apply as for any other alert on the service.

## Before you begin

- You need administrator access.
- The objective must belong to a service and measure **Uptime** or **Availability**.
- An enabled metrics connection (Prometheus, Grafana, Datadog or CloudWatch) that the service's team may
  use. See [observability connections](../operate/intelligence/observability-connections).
- Intelligence must be enabled: policies are evaluated by the intelligence lane, every 5 minutes.

## Set up the alert

1. Go to **Settings → Service objectives**, find the objective and choose **Edit**.
2. Open the **Alerting** tab.
3. Choose the **Metrics connection**.
4. Enter the **Good events query** and the **Total events query**. Each must return a count of events per
   5-minute step in the connection's own language. Every series a query returns is added up. For
   Prometheus:

   ```promql
   sum(increase(http_requests_total{service="checkout",code!~"5.."}[5m]))
   sum(increase(http_requests_total{service="checkout"}[5m]))
   ```

5. Choose **Test queries**. OpsKnight runs both queries over the last hour and shows the SLI, the burn,
   the good and total counts, and how many of the 12 steps had data. Nothing is saved.
6. Turn on **Enable alerting**. Leave **Also open ticket-urgency incidents for slow burns** on unless you
   only want pages.
7. Choose **Save alerting**.

Changing the connection or a query discards the stored measurements: the tiers re-arm as new coverage
builds up. Switching alerting off while an incident is open resolves it at the next evaluation.

## Watch it

Open the service and choose **Intelligence**. In **SLO burn**, each objective with a policy shows its alert
state (**Alerting: OK**, **Alerting: ticket**, **Alerting: paging** or **Alerting off**). Enabled policies
also show the last day as a chart: the SLI per step, the burn over the trailing hour, the tier thresholds as
dashed lines, and the alert transitions underneath. Choose **Table** for the same values as text.

## API and MCP

- `GET /api/v2/service-objectives/{id}/alert-policy`: the policy and its current state (404 without one).
- `PUT /api/v2/service-objectives/{id}/alert-policy`: create or replace the policy. Needs
  `service-objectives:write` and an `Idempotency-Key`; `enabled` defaults to `false`.
- `GET /api/v2/service-objectives/{id}/burn-history?hours=24`: stored steps (up to 168 hours), transitions
  and tier thresholds.

Over MCP, `slo_alert_policy_get` reads the policy. Setting it is approval-gated: an assistant prepares the
change and a person reviews it, because an enabled policy can page people.

## Troubleshooting

The policy's last status explains the latest evaluation:

| Status                     | Meaning                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `OK`                       | Evaluated normally.                                                    |
| `NO_DATA`                  | The queries returned no steps with a total.                            |
| `CONNECTOR_ERROR:<code>`   | The connection failed (for example `TIMEOUT`); the state is unchanged. |
| `CONNECTION_DISABLED`      | Enable the connection again.                                           |
| `CONNECTION_NOT_ALLOWED`   | The connection is no longer open to the service's team.                |
| `NO_CONNECTION`            | The connection was deleted; choose another.                            |
| `EVENT_FAILED`             | The incident could not be raised or resolved; retried next evaluation. |
| `DISABLED`                 | Alerting is off.                                                       |
| `OBJECTIVE_INACTIVE`       | The objective was archived; any open incident is resolved.            |

Measurements are kept for 30 days.
