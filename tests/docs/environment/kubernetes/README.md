# Ephemeral Kubernetes boundary

These manifests create a complete disposable documentation environment: an
immutable OpsKnight test runtime, PostgreSQL, Slack/Teams/Jira/webhook mocks,
Mailpit, namespace-scoped observation RBAC, quotas, and network isolation. They
contain fixture-only credentials and no production secrets or cluster-wide
permissions.

```sh
sh scripts/docs/run-kubernetes-journeys.sh
```

The runner waits for all workloads, forwards only the application and fixture
database to loopback, seeds through the normal Playwright setup, runs the same
journeys used by Compose certification, and deletes the namespace on exit. The
cleanup script refuses any namespace except `opsknight-docs`.
