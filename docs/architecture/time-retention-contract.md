# Time and retention contract

`src/lib/time-retention-contract.ts` is the pure boundary for reporting clocks,
timezone roles, query windows, and retention clipping. Database-backed policy
loading remains in `src/lib/retention-policy.ts`, which delegates its date bounds
to the contract.

## Rules

- Capture `now` once at the entry point and inject it into every calculation.
- User timezone controls display and user-selected calendar boundaries.
- Business timezone controls business-hours and operational classification.
- Retention is an absolute duration and cannot depend on the server timezone.
- Never silently swap an inverted interval. Collapse it and report
  `start_after_end`.
- Consumers must surface `clipReasons` when the requested interval was not fully
  honored.
- Invalid or missing IANA timezone values normalize to UTC.

The reporting window is inclusive at both ends for current Prisma query
compatibility. Consumers implementing cursor or SQL half-open intervals must do
that conversion after resolving the canonical window.
