# Product surface parity report

- Release: 2.0.0
- Documentation pages scanned: 321
- Task-oriented pages scanned: 200
- Action-bearing lines inspected by the automated guard: 2396
- Explicit cross-surface contracts: 3
- Forbidden surface-pattern violations remaining: 0

## Enforced high-risk contracts

- `incident.escalate`: web=`NOT_SUPPORTED`, mobile=`NOT_SUPPORTED`, slack=`NOT_SUPPORTED`, teams=`PARTIAL`, api=`NOT_SUPPORTED`, automatic=`SUPPORTED`
- `incident.reopen`: web=`NOT_SUPPORTED`, mobile=`NOT_SUPPORTED`, slack=`NOT_SUPPORTED`, teams=`NOT_SUPPORTED`, api=`API_ONLY`, automatic=`AUTOMATIC_ONLY`
- `incident.assign`: web=`SUPPORTED`, mobile=`SUPPORTED`, slack=`PARTIAL`, teams=`PARTIAL`, api=`SUPPORTED`, automatic=`SUPPORTED`

This report is generated from every 2.0 Markdown page and the implementation-backed
surface registry. It is a lexical false-claim alarm, not a substitute for the
runtime/API evidence required by each task page.
