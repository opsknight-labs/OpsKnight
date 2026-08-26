# OpsKnight Kustomize deployment profiles

Kustomize supports the same runtime topologies as the Helm chart. Because Kustomize has no values switch, topology selection is expressed as explicit profiles.

## Integrated (backward-compatible default)

Equivalent to Helm `runtime.mode=integrated`:

```bash
kubectl apply -k k8s
# or
kubectl apply -k k8s/profiles/integrated
```

Defaults: 2 integrated pods, PostgreSQL pool limit 40 per pod, 30s termination grace.

The root `k8s/` entry point remains integrated for upgrade compatibility. For new production Kubernetes deployments, prefer the split profile below.

## Split runtime — recommended for production

Equivalent to Helm `runtime.mode=split`:

```bash
kubectl apply -k k8s/profiles/split
```

Defaults: 2 baseline web pods, web HPA 2–12 at 70% CPU, 2 workers, 1 scheduler; DB pools 10/10/5; web CPU request 250m and limit 1000m; worker batch 100, concurrency 15, idle poll 1000ms, busy poll 100ms; worker termination grace 60s.

The split profile includes `k8s/components/web-hpa` by default. The modest CPU request keeps baseline scheduling cost low, while the 1000m limit gives each Node.js process burst headroom and HPA adds replicas when CPU demand is sustained.

The HPA requires the Kubernetes resource Metrics API. Without resource metrics, the two baseline web replicas continue to run but automatic scaling cannot calculate desired replicas.

## Split runtime + PgBouncer

Equivalent to Helm `runtime.mode=split` with `pgbouncer.enabled=true`:

```bash
kubectl apply -k k8s/profiles/split-pgbouncer
```

Topology:

```text
web -> PgBouncer -> PostgreSQL
worker ----------> PostgreSQL
scheduler --------> PostgreSQL
```

PgBouncer defaults match Helm: transaction pooling, port 6432, max client connections 1000, default backend pool 40, reserve pool 10, max prepared statements 100, Prisma `search_path` startup compatibility, numeric non-root uid/gid 70, one replica.

The split-PgBouncer profile inherits the split web HPA. The bundled PgBouncer auth Secret is a placeholder and must be kept synchronized with PostgreSQL credentials before production use.

## Components

- integrated HPA: `k8s/components/integrated-hpa`
- split/web HPA: `k8s/components/web-hpa` — included by the split profile
- ingress: `k8s/components/ingress`
- network policy: choose the component matching the selected runtime profile

Kustomize does not provide runtime value flags. Environment-specific HPA bounds, replicas, resources, pools, ingress, and policy settings should be changed with standard Kustomize patches in an environment-owned customization.

CI renders the three topology profiles and checks their key settings against Helm renders to prevent deployment drift.
