---
order: 6
title: System Logs
description: Use the live in-process log viewer safely and preserve durable application logs externally.
---

# System Logs

The System Logs page is a short-lived view into the current application process. It helps an Admin inspect recent errors, but it is not a durable store and must not be the only source for alerting, auditing, or incident evidence.

## Open and filter logs

1. Sign in with the **ADMIN** role.
2. Open `/system-logs` on your OpsKnight URL.
3. Select a level card or filter by level, message/error text, or component.
4. Expand a row for context, stack trace, request ID, user ID, and duration when present.

The view returns at most the newest **500** entries, newest first.

## Storage model and limits

- Entries live in process memory and disappear when that process restarts.
- Every replica has its own buffer; the page does not aggregate replicas.
- When full, the oldest entry is discarded.
- The page has no time-range query, pagination, download, or export.
- Data Retention's **System Logs** value governs database `LogEntry` rows, not this buffer.
- Audit records use a separate PostgreSQL table and viewer.

With load balancing, requests can reach different replicas and show different entries. Use centralized logs to search all replicas.

## Logger configuration

| Variable         | Behavior                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`      | Minimum level: `debug`, `info`, `warn`, or `error`; default `info`.                          |
| `LOG_FORMAT`     | `json` enables structured output. Production defaults to JSON; development to pretty output. |
| `LOG_BUFFER_MAX` | Process buffer capacity; default `500`. Set `0` to disable buffering.                        |

Standard output is the production collection boundary. Configure the platform to collect it into a centralized service with retention, access control, search, and alerts.

## Sensitive-data handling

Before buffering, the logger redacts context keys matching common password, token, secret, key, authorization, email, session, and cookie names. It also replaces email-shaped strings in messages and errors.

Redaction is defense in depth, not a guarantee. Unexpected key names, bodies, URLs, stack traces, and third-party output can still contain sensitive data. Never intentionally log credentials, sessions, complete inbound payloads, or unnecessary personal data.

## Troubleshooting workflow

1. Note the failure time, action, user, service, and request ID.
2. Filter **Errors**, then **Warnings**.
3. Match request IDs and components in centralized platform logs.
4. Check `/api/health` and PostgreSQL connectivity for broad failures.
5. Correlate configuration changes in [Audit Logs](audit-logs.md).
6. Preserve external logs before their retention window closes.

### No entries appear

- Confirm you are an Admin; other roles are redirected.
- Check `LOG_BUFFER_MAX` is greater than zero and `LOG_LEVEL` permits the entry.
- Reproduce on the same replica if possible.
- Inspect standard output; the process may have restarted.

### Entries change between requests

You are likely reaching different replicas or a restarting process. Centralize platform logs instead of depending on sticky routing.

## Production baseline

- collect JSON standard output from every replica;
- add environment, release, pod/container, and region metadata in the log platform;
- alert on sustained errors and health failures;
- define separate retention for operational logs and audit evidence;
- test redaction and access controls;
- keep the in-app page as a convenience, not a dependency.

## Related topics

- [Monitoring](../deployment/monitoring.md)
- [Troubleshooting](../troubleshooting.md)
- [Audit logs](audit-logs.md)
- [Data retention](data-retention.md)
- [Security](../security/README.md)
