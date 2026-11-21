---
title: Helm pre-upgrade runtime gate
description: When the chart requires every application Deployment to be stopped before an upgrade, and how to configure it.
type: reference
product_area: deployment
audience: [operator, administrator]
keywords: [Helm upgrade, pre-upgrade hook, auth-cutover, maintenance window, Flux, GitOps]
verification:
  level: source
  verified_at: 2026-11-19
  evidence:
    - deploy/kubernetes/helm/opsknight/templates/authentication-cutover.yaml
    - deploy/kubernetes/helm/opsknight/values.yaml
    - scripts/check-authentication-cutover.cjs
    - tests/deployment/sso-cutover.test.mjs
---

# Helm pre-upgrade runtime gate

The chart runs a pre-upgrade Job named `<release>-opsknight-auth-cutover` before
the migration Job. It fails the upgrade unless every application Deployment
(integrated or split roles) is at zero replicas and no application pods remain.
This keeps an older runtime from overlapping a newer database schema.

## When the gate runs

`upgradeGates.authenticationCutover.mode` controls it:

| Mode             | Gate runs                                                                |
| ---------------- | ------------------------------------------------------------------------ |
| `auto` (default) | Only when the upgrade changes the application image                      |
| `always`         | On every upgrade, including values-only changes (behaviour up to 2.1.2)  |
| `never`          | Never; you are responsible for stopping the runtime before image changes |

In `auto` mode the chart reads the live Deployments and compares the image of
the `opsknight` container with the target image. A values-only upgrade (same
image) skips the gate, so configuration changes no longer need downtime. If no
Deployment can be read, for example under `helm template` or `--dry-run`, the
gate runs.

Up to 2.1.2 the gate ran on every upgrade. Any values change then needed all
Deployments at zero, and GitOps controllers such as Flux retried and rolled
back the release in a loop.

## Upgrade to a new image

When the image changes, the gate still runs. Stop the runtime first:

```bash
APP='app.kubernetes.io/instance=opsknight,app.kubernetes.io/component!=pgbouncer'
kubectl -n opsknight scale deployment -l "$APP" --replicas=0
kubectl -n opsknight wait pod -l "$APP" --for=delete --timeout=5m
helm upgrade opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight --values values.production.yaml \
  --set image.digest=sha256:<tested digest>
```

PgBouncer can keep running; the gate ignores it. The runbook agent, when
enabled, is stopped with the application roles.
An image upgrade still requires an explicit `image.tag` or `image.digest`.

## GitOps controllers

With `auto`, configuration changes reconcile without downtime. For image
upgrades, stop the runtime as part of the change, or set `mode: never` and run
your own stop step before the new image rolls out. Limit upgrade remediation
retries in the controller so a failed gate is reported instead of retried in a
loop.

For the full upgrade procedure see the
[Helm upgrade guide](./upgrade.md).
