---
order: 6
title: Deployment
description: Deploy OpsKnight with Docker, Kubernetes, or Helm for production use
---

# Deployment Guide

This section covers production deployment of OpsKnight. Choose the deployment method that best fits your infrastructure and operational needs.

---

## Deployment Options

| Method                                | Best For                  | Complexity | HA Support |
| ------------------------------------- | ------------------------- | ---------- | ---------- |
| [Docker Compose](./deployment/docker) | Small teams, dev/staging  | Low        | No         |
| [Kubernetes](./deployment/kubernetes) | Production, enterprise    | Medium     | Yes        |
| [Helm](./deployment/helm)             | Templated K8s deployments | Medium     | Yes        |
| [Mobile PWA](./deployment/mobile-pwa) | Mobile access             | N/A        | N/A        |

---

## Quick Comparison

| Feature                | Docker Compose | Kubernetes         | Helm               |
| ---------------------- | -------------- | ------------------ | ------------------ |
| **Setup Time**         | 5 minutes      | 30 minutes         | 15 minutes         |
| **Scaling**            | Manual         | Auto (HPA)         | Auto (HPA)         |
| **High Availability**  | No             | Yes                | Yes                |
| **Rolling Updates**    | Limited        | Yes                | Yes                |
| **Resource Limits**    | Basic          | Advanced           | Advanced           |
| **Secrets Management** | Env files      | K8s Secrets        | Values/Secrets     |
| **Ingress/TLS**        | Manual         | Ingress Controller | Ingress Controller |
| **Monitoring**         | Manual         | Built-in           | Built-in           |

---

## Prerequisites

### All Deployments

| Requirement                | Notes                   |
| -------------------------- | ----------------------- |
| **PostgreSQL 14+**         | Primary database        |
| **Domain name**            | For production access   |
| **SSL certificate**        | HTTPS required for auth |
| **SMTP server** (optional) | For email notifications |

### Docker Compose

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB RAM minimum
- 10GB disk space

### Kubernetes

- Kubernetes 1.24+
- kubectl configured
- Ingress Controller (nginx, traefik, etc.)
- Persistent Volume provisioner
- 8GB RAM cluster minimum

### Helm

- Helm 3.10+
- All Kubernetes prerequisites

---

## Architecture Overview

### Single-Node (Docker Compose)

```
┌─────────────────────────────────────────────┐
│                  Host Server                │
│  ┌─────────────┐  ┌─────────────────────┐   │
│  │  OpsKnight  │  │    PostgreSQL       │   │
│  │   (Next.js) │  │    (Database)       │   │
│  │   Port 3000 │  │    Port 5432        │   │
│  └─────────────┘  └─────────────────────┘   │
│         │                   │               │
│         └───────────────────┘               │
│                    │                        │
│  ┌─────────────────┴────────────────────┐   │
│  │           Docker Network             │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Multi-Node (Kubernetes)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                           │
│                                                                     │
│  ┌─────────────┐    ┌─────────────────────────────────────────┐    │
│  │   Ingress   │───▶│            OpsKnight Pods               │    │
│  │  Controller │    │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │    │
│  └─────────────┘    │  │ Pod 1   │ │ Pod 2   │ │ Pod 3   │   │    │
│                     │  └─────────┘ └─────────┘ └─────────┘   │    │
│                     └─────────────────┬───────────────────────┘    │
│                                       │                            │
│                     ┌─────────────────┴───────────────────┐        │
│                     │     PostgreSQL (StatefulSet)        │        │
│                     │  ┌─────────────────────────────┐    │        │
│                     │  │   Primary    │   Replica    │    │        │
│                     │  └─────────────────────────────┘    │        │
│                     └─────────────────────────────────────┘        │
│                                       │                            │
│                     ┌─────────────────┴───────────────────┐        │
│                     │      Persistent Volume Claims        │        │
│                     └─────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start: Docker Compose

Fastest way to get started:

```bash
# Clone repository
git clone https://github.com/opsknight-labs/opsknight.git
cd opsknight

# Configure environment
cp env.example .env
# Edit .env with your settings

# Start services
docker compose up -d
```

Access at `http://localhost:3000` — you'll be directed to `/setup` to create your admin account.

[Full Docker Guide →](./deployment/docker)

---

## Quick Start: Kubernetes

Using raw manifests:

```bash
# Clone repository
git clone https://github.com/opsknight-labs/opsknight.git
cd opsknight/k8s

# Create namespace
kubectl create namespace opsknight

# Apply configs (edit first!)
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml

# Deploy PostgreSQL
kubectl apply -f postgres/

# Deploy OpsKnight
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
```

[Full Kubernetes Guide →](./deployment/kubernetes)

---

## Quick Start: Helm

Using Helm charts:

```bash
# Add OpsKnight Helm repo (if published)
# helm repo add opsknight https://charts.opsknight.com

# Or use local chart
cd opsknight/helm

# Install with values
helm install opsknight ./opsknight \
  --namespace opsknight \
  --create-namespace \
  --values values.yaml
```

[Full Helm Guide →](./deployment/helm)

---

## Environment Variables

### Required Variables

| Variable          | Description                 | Example                                 |
| ----------------- | --------------------------- | --------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection       | `postgresql://user:pass@host:5432/db`   |
| `NEXTAUTH_URL`    | Application base URL        | `https://opsknight.yourco.com`          |
| `NEXTAUTH_SECRET` | Session secret (32+ chars)  | Generate with `openssl rand -base64 32` |
| `APP_URL`         | Application URL (for links) | `https://opsknight.yourco.com`          |

### Optional Variables

| Variable         | Description                      | Default        |
| ---------------- | -------------------------------- | -------------- |
| `ENCRYPTION_KEY` | Secrets encryption (32-byte hex) | Auto-generated |

| `LOG_LEVEL` | Logging verbosity | `info` |

### Notification Providers

Configure in UI or via environment:

| Variable             | Description         |
| -------------------- | ------------------- |
| `SMTP_HOST`          | SMTP server host    |
| `SMTP_PORT`          | SMTP server port    |
| `SMTP_USER`          | SMTP username       |
| `SMTP_PASS`          | SMTP password       |
| `TWILIO_ACCOUNT_SID` | Twilio account SID  |
| `TWILIO_AUTH_TOKEN`  | Twilio auth token   |
| `TWILIO_PHONE`       | Twilio phone number |

---

## Production Checklist

### Security

- [ ] HTTPS enabled with valid SSL certificate
- [ ] Strong `NEXTAUTH_SECRET` (32+ characters)
- [ ] Database credentials secured
- [ ] Encryption key configured
- [ ] Network policies in place (K8s)
- [ ] Pod security policies applied (K8s)

### High Availability

- [ ] Multiple OpsKnight replicas (K8s)
- [ ] PostgreSQL replication
- [ ] Load balancer configured
- [ ] Health checks enabled
- [ ] Persistent storage for database

### Monitoring

- [ ] Health endpoint monitored (`/api/health`)
- [ ] Resource limits configured
- [ ] Logging aggregation set up
- [ ] Alerting on OpsKnight itself

### Backups

- [ ] Database backup schedule
- [ ] Configuration backup (secrets, configmaps)
- [ ] Disaster recovery plan tested

### Performance

- [ ] Resource requests/limits tuned
- [ ] Database connection pooling
- [ ] CDN for static assets (optional)
- [ ] Horizontal Pod Autoscaler configured (K8s)

---

## Upgrading OpsKnight

### Docker Compose

```bash
# Pull latest image
docker compose pull

# Restart with new image
docker compose up -d

# Run migrations (if needed)
docker exec -it opsknight_app npx prisma migrate deploy
```

### Kubernetes

```bash
# Update image tag in deployment
kubectl set image deployment/opsknight \
  opsknight=opsknight/opsknight:v1.1.0 \
  -n opsknight

# Or apply updated manifests
kubectl apply -f deployment.yaml
```

### Helm

```bash
# Update values.yaml with new image tag
# Then upgrade release
helm upgrade opsknight ./opsknight \
  --namespace opsknight \
  --values values.yaml
```

---

## Troubleshooting

### Application Won't Start

1. Check logs: `docker compose logs` or `kubectl logs`
2. Verify DATABASE_URL is correct
3. Ensure database is accessible
4. Check NEXTAUTH_URL matches actual URL

### Database Connection Errors

```bash
# Test connection
docker exec -it opsknight_app npx prisma db pull

# Check PostgreSQL logs
docker compose logs postgres
# or
kubectl logs -l app=postgres
```

### SSL/TLS Issues

1. Verify certificate is valid
2. Check NEXTAUTH_URL uses https://
3. Ensure ingress TLS is configured

### Performance Issues

1. Check resource limits
2. Monitor database queries
3. Review connection pool settings
4. Scale horizontally if needed

---

## Related Topics

- [Getting Started](./getting-started) — Initial setup
- [Configuration](./getting-started/configuration) — Environment reference
- [Architecture](./architecture) — System design
- [Security](./security) — Security configuration
