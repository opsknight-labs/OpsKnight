---
title: Business service health
description: How OpsKnight decides whether a business service is operational, degraded or down, and how impact history drives uptime.
type: concept
product_area: services
audience: [responder, administrator, viewer]
keywords: [business services, health, impact, criticality, tier, dependency, uptime]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/lib/business-services/health.ts
    - src/lib/business-services/impacts.ts
    - src/lib/business-services/stats.ts
    - tests/lib/business-services/health.test.ts
    - tests/integration/business-services-engine.test.ts
---

# Business service health

A business service (such as **Checkout**) is healthy or not because of **open incidents**, not
because of the status someone set on a technical service. One engine computes it, and the
catalog, `/m/status`, incident **Impacts**, follower notifications, REST v2 and MCP all read the
same result.

Only open and acknowledged incidents count. Snoozed, suppressed and maintenance-held incidents
never make a business service unhealthy.

## Thresholds

Each business service decides which incidents matter. An incident counts when its urgency is at
least the minimum urgency **or** its priority is at least as severe as the maximum priority.

| Criticality    | Counts when                        |
| -------------- | ---------------------------------- |
| `TIER_0`       | High urgency, or priority P1 or P2 |
| `TIER_1`       | High urgency, or priority P1 or P2 |
| `TIER_2`       | High urgency, or priority P1       |
| `TIER_3`       | High urgency                       |
| none (default) | Every open incident                |

`impactMinUrgency` and `impactMaxPriority` on the business service override the tier default,
each on its own.

## Why it has its status

Every status comes with its reasons. The worst reason wins.

| Reason        | When                                                                                                        | Status                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DIRECT`      | An incident that meets the threshold is open on a member service                                            | Low: degraded, medium: partial outage, high: major outage. Non-critical members stop at degraded |
| `DEPENDENCY`  | A critical member depends (up to 3 hops in the service dependency graph) on a service with such an incident | Same mapping, at most partial outage                                                             |
| `NESTED`      | A business service it depends on (up to 3 levels) is degraded or worse                                      | Degraded                                                                                         |
| `MANUAL`      | A responder marked the incident as impacting it, even below the threshold                                   | Same mapping as `DIRECT`                                                                         |
| `MAINTENANCE` | Every critical member (every member when none is critical) is in a maintenance window                       | Under maintenance; any outage reason still wins                                                  |

A responder can also **unmark** an incident for a business service. That removes every reason the
incident gave it, including impact through a supporting business service, and the exclusion is
remembered for the life of the incident (until someone marks it again).

Business services depend on each other without cycles: a change that would make one depend on
itself, directly or through others, is rejected.

The open incident count is the number of distinct incidents behind the reasons, so one incident
seen through two members counts once.

## Freshness

Health is computed once for the whole organization and cached for 20 seconds; a change to
incidents starts a new computation, and a cached result up to 5 minutes old can be served while a
fresh one is computed. Each reader then sees only the business services in their scope.

## Impact history and uptime

Every impact is also recorded as an interval (incident, business service, reason, start, end). It
is written off the paging path when an incident is created, acknowledged, resolved or otherwise
changes, and a reconcile every minute repairs anything missed. A resolved incident that reopens
starts a new interval, so the time it was resolved is not counted as impact. Unmarked impacts stay
in the history, flagged, and are left out of the numbers.

- **Uptime** is the share of the window with no impact, using the **union** of impact intervals,
  so two overlapping incidents count once.
- **Incident count** is distinct incidents. **MTTA** and **MTTR** average acknowledgement and
  resolution times over those incidents.
- The numbers cover every interval in the window; the listed timeline shows the newest 500.
- Incident ids, titles and urgency in the timeline and in health reasons are shown only to people
  who can read that incident. Others, such as stakeholders, see the intervals and the numbers.

`scripts/backfill-business-service-impacts.ts` writes `DIRECT` history for the last 90 days of
incidents using today's membership, skipping snoozed and suppressed incidents like the live
engine. It is a dry run unless you pass `--apply`, and it never touches a business service and
incident that already have history.

Public status pages are different: they only reflect public incidents, so their business-service
rows take the worst published member status, and their uptime is the union of the members'
downtime.

## Related

- [Business services](../guides/services/business-services)
- [Services](./services)
- [Status pages](./status-pages)
