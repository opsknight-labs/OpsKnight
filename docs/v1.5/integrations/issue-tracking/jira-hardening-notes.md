# Jira enterprise hardening notes

This release hardens Jira credential, ownership, inbound ordering, and provider-failure boundaries.

- Stored API tokens are origin-bound. Changing the Jira site origin requires a fresh token.
- Jira links have exactly one OpsKnight owner. Same-key linking is serialized and persisted create-only.
- Inbound Jira deliveries use durable delivery claims where a stable provider/domain delivery identity exists.
- Same-issue webhook mutations are serialized across replicas.
- Jira issue `updated` time is the provider ordering clock when available; older events cannot overwrite newer accepted state.
- Jira deletion events preserve the historical reference while marking it deleted/failed rather than healthy and synchronized.
- Jira `Retry-After` metadata reaches durable retry scheduling.
- Repeated transient provider failures open a shared workspace cooldown.
- Durable CREATE operations terminate as `FAILED` when their retry budget is exhausted rather than remaining permanently `AMBIGUOUS`.
- Configured Jira URLs reject embedded credentials, query/fragment confusion, loopback/link-local, and common metadata targets.
