# Live dashboard realtime: architecture, HA assumptions and operations

This describes how the Command Center / Live Incidents dashboard and the TV wallboard get their
data, what is shared between application replicas, what is not, and how to run it behind more than
one replica. It deliberately makes **no claim about concurrent-user capacity**: capacity has not
been certified (see [Known limitations](#known-limitations)).

## How it works

```
PostgreSQL ── RealtimeChange (durable, bounded change clock; statement triggers on Incident/Service)
     │  polled ~1/s, once per application process
     ▼
Application process ── SSE fan-out ──► browser (ONE EventSource per tab)
     │                                   │ `changed {generation}` signals
     │                                   ▼
     └──◄── GET /api/dashboard/live ◄── authorization-scoped read, ETag/304
```

- **One stream per browser tab.** `RouteAwareRealtimeProvider` owns the only `EventSource`. Regular
  screens use the full stream (legacy incident and metrics payloads); the dashboard (`/`) and the
  wallboard use `?mode=signal`, which carries only `connected`, `changed {generation}` and
  heartbeats. Navigating between the two switches the mode on the same provider: the previous
  stream is closed before the next opens.
- **Signals invalidate; the API is the source of truth.** A `changed` generation triggers a
  rate-limited, jittered read of `/api/dashboard/live`. Console-wide features that normally read
  the full stream (global critical-incident alerts, sidebar badge) are fed from the dashboard's own
  snapshot (`alerts`, `summary.visibleActive`) while it runs in signal mode.
- **Generation watermark.** Responses carry `X-Live-Generation` (also on `304`): the realtime
  generation the data actually reflects. If that is behind a generation already announced by a
  signal (a lagging replica, a delayed query), the client performs a bounded catch-up (4 attempts
  with growing delay), never replaces newer state with an older answer, and reports `stale`
  rather than `live` if it cannot converge. The 30 s safety read still runs.
- **Conditional responses.** The ETag is a digest of the content of every dataset read plus the
  viewer identity, query, page size, pins and a 5-second time bucket. A matching `If-None-Match`
  is answered `304` before anything is derived or serialized.

## What is exact and what is not

The in-memory working set is the newest 2,000 active incidents per authorization partition plus up
to 1,000 older ones that are critical, unowned, escalating or whose next SLA transition is
imminent. When the set is truncated:

| Part | Source | Reported as |
| --- | --- | --- |
| Headline counters (active, triggered, acknowledged, critical, unassigned, unassigned-critical), visible-active badge | indexed `COUNT` queries over the viewer's whole scope | `accuracy.counters = exact` |
| Filtered total | exact for a plain `active`/`critical`/`unassigned` view; otherwise derived from the window | `accuracy.filtered` |
| SLA at risk / due soon / breached, attention list | derived from the window (SLA hints are advisory) | `accuracy.sla = window` (never `exact` when truncated) |
| 24 h trend and MTTA/MTTR | one indexed read per timestamp, capped at 5,000 rows each | `accuracy.trend = capped` when a cap was hit |

Anything beyond the window is reachable through `GET /api/dashboard/live/page` (keyset pagination
by `createdAt, id`; "Load older incidents" in the panel). A cursor is only a position; the viewer's
authorization scope is re-derived from the session on every request, and title search never
matches incidents whose source is redacted for the viewer.

## Authorization and cache isolation

- Active incidents are cached in **partitions**: a team-visible partition shared by every viewer
  with the same team set (and sensitivity), and a small personal partition (assigned / watching)
  per user. Both are composed from `incidentReadWhereParts`, the same source as
  `incidentReadWhere`, so they cannot drift.
- The actor is resolved from the database on every request; a cache hit never skips it. Team,
  role or status changes select different cache keys immediately.
- Schedule and on-call caches are keyed by the authorization filter itself, not by user id.
- SSE streams re-validate account status, role, team set, token version and the session registry
  on every heartbeat (15 s plus up to 2 s jitter), coalesced per session. Failure to verify closes
  the stream fail-closed with `authorization_revoked`; the browser then drops its snapshot,
  selection and pagination state and stops reading.

## Running more than one replica

Every replica serves dashboard snapshots on its own and needs nothing from its peers. The only
cross-replica mechanism is the durable PostgreSQL generation.

- **Process-local state is an optimization, never a correctness dependency**: partition caches,
  derived-projection memos and the schedule cache. Each replica queries PostgreSQL for a partition
  at most about once per time window; with N replicas expect up to N such queries per window.
- Use identical `NEXTAUTH_SECRET`/encryption settings on all replicas so a session issued by one
  is valid on another.
- **Reverse proxy**: disable response buffering for `/api/realtime/stream` (the route sets
  `X-Accel-Buffering: no`), keep idle/read timeouts above 60 s (heartbeats arrive every 15-17 s),
  and do not pin streams to a replica — any replica can serve any request.
- **PgBouncer**: each replica holds its own Prisma pool; size
  `replicas × connection_limit` below PgBouncer's `default_pool_size`/Postgres `max_connections`.
  Use transaction pooling; the application does not rely on session state.
- **Rolling deployment**: on SIGTERM a replica refuses new streams (`503`, `Retry-After: 5`) and
  closes its open streams spread over ~3 s; browsers treat that as a recoverable disconnect,
  reconnect with jittered backoff and re-read canonical state. Allow
  `terminationGracePeriodSeconds` ≥ 30. New clients tolerate older replicas (missing
  `X-Live-Generation`, `alerts`, `accuracy`, or a 404 on the page endpoint); older clients ignore
  the new fields.
- **High availability scope**: running multiple application replicas gives *application-level*
  HA. End-to-end HA additionally needs a highly available PostgreSQL (primary with automatic
  failover or a managed equivalent). A single PostgreSQL node is a single point of failure for
  incident visibility and must not be described as fully HA. During a database outage the
  dashboard keeps the last valid snapshot, reports `stale`, backs off (5 s to 60 s with jitter),
  and recovers without a reload.

## Observability

Metrics carry no user or incident identifiers.

| Metric | Meaning |
| --- | --- |
| `opsknight_realtime_streams_active{mode}` | open SSE streams on this instance |
| `opsknight_realtime_streams_opened_total{mode}` | stream opens (its rate is the reconnection rate) |
| `opsknight_realtime_streams_closed_total{reason}` | `client`, `slow_consumer`, `revoked`, `shutdown`, `error` |
| `opsknight_realtime_subscribers{stream}`, `…_observed_generation`, `…_change_age_seconds`, `…_clock_errors_total` | change-clock poller |
| `opsknight_realtime_cache_bytes`, `opsknight_realtime_cache_entries` | process-local cache budget (96 MiB default, `REALTIME_CACHE_MAX_BYTES`) |
| `opsknight_dashboard_live_requests_total{result}` | `full`, `not_modified`, `error` |
| `opsknight_dashboard_live_request_duration_seconds` | end-to-end snapshot request time |
| `opsknight_dashboard_live_set_duration_seconds` | one working-set read |
| `opsknight_dashboard_live_partition_reads_total{result}` | cache `hit` / `miss` for working-set partitions |
| `opsknight_dashboard_live_generation_lag` | generations the last snapshot reflected behind the viewer's |

Responses include `Server-Timing` (`auth`, `generation`, `snapshot`, `etag`, `encode`).

## The change clock

`RealtimeChange` is appended by statement-level triggers inside the writing transaction and is
trimmed every 1,000th insert (`id < new_id - 10000`). The trim is a bounded delete of old rows
that no reader touches, performed inside one writer's transaction.

Known property: ids come from a sequence, so two concurrent transactions can commit in the
opposite order of their ids. A reader that already observed the higher id will not see a signal
for the lower one that commits just after. This is bounded by the client's 30 s safety read, the
reconnect read and the catch-up logic, but a change can be visible up to that long later in this
rare interleaving.

## Known limitations

- **Capacity is not certified.** The local load tool (`npm run load:dashboard`) exists for
  engineering, not as evidence. No claim is made about the number of concurrent viewers or the
  incident rate supported.
- SLA figures are window-based when the working set is truncated.
- `breaching` (SLA-derived) cannot be paged from the database.
- Distinct per-user scopes multiply the personal-partition work; the team-visible partition is
  shared per team set.
- Failover of PostgreSQL itself is outside this feature.

## Functional verification

```bash
npm run seed:dashboard -- --scenario=normal
# two replicas of the same production build on the same database and secrets
npm run certify:dashboard:replicas -- --a=http://localhost:3201 --b=http://localhost:3202 --pid-a=<PID>
npm run test:e2e:dashboard
```
