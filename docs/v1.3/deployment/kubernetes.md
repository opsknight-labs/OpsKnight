---
order: 2
---

# Kubernetes Deployment

Deploy OpsKnight on Kubernetes for production workloads and horizontal scaling.

## Prerequisites

- Kubernetes 1.24+
- `kubectl` configured
- Ingress controller (nginx-ingress or similar)
- PostgreSQL (in-cluster or managed)

## Quick Start (Manifests)

```bash
cd k8s

# Create namespace
kubectl apply -f namespace.yaml

# Create secrets (edit first!)
kubectl apply -f secret.yaml

# Deploy
kubectl apply -f .
```

## Manifest Overview

| File              | Purpose                   |
| ----------------- | ------------------------- |
| `namespace.yaml`  | OpsKnight namespace       |
| `secret.yaml`     | Sensitive configuration   |
| `configmap.yaml`  | Non-sensitive config      |
| `deployment.yaml` | Application deployment    |
| `service.yaml`    | Internal service          |
| `ingress.yaml`    | External access           |
| `hpa.yaml`        | Horizontal Pod Autoscaler |
| `postgres-*.yaml` | PostgreSQL (optional)     |

## Configuration

### Secrets

Edit `secret.yaml` before applying:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: opsknight-secrets
  namespace: opsknight
type: Opaque
stringData:
  DATABASE_URL: postgresql://user:pass@postgres:5432/opsknight
  NEXTAUTH_SECRET: your-32-char-secret
  NEXTAUTH_URL: https://ops.yourcompany.com
```

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: opsknight-config
  namespace: opsknight
data:
```

> **Note:** Store secrets in `Secret` objects and keep the ConfigMap non-sensitive.

## Ingress

Configure for your domain and TLS:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: opsknight-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - ops.yourcompany.com
      secretName: opsknight-tls
  rules:
    - host: ops.yourcompany.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: opsknight
                port:
                  number: 3000
```

## Scaling

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: opsknight-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: opsknight
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Database Options

### In-Cluster PostgreSQL

Apply the included manifests:

```bash
kubectl apply -f postgres-pvc.yaml
kubectl apply -f postgres-statefulset.yaml
kubectl apply -f postgres-service.yaml
```

### Managed PostgreSQL

Use AWS RDS, GCP Cloud SQL, or Azure Database:

- Update `DATABASE_URL` in your Secret.
- Ensure network connectivity from the cluster.

## Updating

```bash
# Update image
kubectl set image deployment/opsknight \
  opsknight=ghcr.io/your-org/opsknight:latest

# Or apply updated manifests
kubectl apply -f deployment.yaml
```

## Troubleshooting

```bash
# View pods
kubectl get pods -n opsknight

# View logs
kubectl logs -f deploy/opsknight -n opsknight

# Shell access
kubectl exec -it deploy/opsknight -n opsknight -- sh
```

## Verification

- Ensure the deployment is `Ready`.
- Confirm ingress routes to the service.
- Log in and create a test service to validate persistence.
