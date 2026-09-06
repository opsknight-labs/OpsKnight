---
order: 1
title: Getting Started
description: Everything you need to install, configure, and start using OpsKnight
---

# Getting Started

This section will take you from zero to a fully operational incident management system. By the end, you'll have OpsKnight running, your first service configured, and understand how to create and manage incidents.

<!-- placeholder:getting-started-overview -->
<!-- Add: Screenshot showing the OpsKnight login page or initial dashboard -->

---

## What You'll Learn

| Guide                                            | What You'll Accomplish                                    |
| ------------------------------------------------ | --------------------------------------------------------- |
| [Installation](./getting-started/installation)   | Get OpsKnight running with Docker, Kubernetes, or locally |
| [Configuration](./getting-started/configuration) | Understand environment variables and system settings      |
| [First Steps](./getting-started/first-steps)     | Create your first service, incident, and on-call schedule |

---

## Prerequisites

Before installing OpsKnight, ensure you have the following:

### For Docker Deployment (Recommended)

- **Docker Engine** v20.10 or later
- **Docker Compose** v2.0 or later
- **4GB RAM** minimum (8GB recommended)
- **10GB disk space** for images and data

### For Kubernetes Deployment

- **Kubernetes** v1.24 or later
- **Helm** v3.10 or later (for Helm deployments)
- **kubectl** configured for your cluster
- **Persistent Volume** provisioner for PostgreSQL storage

### For Local Development

- **Node.js** v18 or later
- **PostgreSQL** v14 or later
- **npm** or **yarn** package manager
- **Git** for cloning the repository

---

## Deployment Options

Choose the deployment method that fits your needs:

| Method                     | Best For                                         | Complexity |
| -------------------------- | ------------------------------------------------ | ---------- |
| **Docker Compose**         | Development, small teams, quick evaluation       | Low        |
| **Kubernetes (Kustomize)** | Production, scaling, existing K8s infrastructure | Medium     |
| **Kubernetes (Helm)**      | Production with templated configuration          | Medium     |
| **Local Development**      | Contributing, debugging, testing changes         | Medium     |

---

## Quick Start (5 Minutes)

Want to get started immediately? Here's the fastest path:

```bash
# 1. Clone the repository
git clone https://github.com/opsknight-labs/opsknight.git
cd opsknight

# 2. Copy and configure environment
cp env.example .env
# Edit .env: Set NEXTAUTH_SECRET (generate with: openssl rand -base64 32)

# 3. Start all services
docker compose up -d

# 4. Open OpsKnight
open http://localhost:3000
```

**First-Time Setup**: On first launch, you'll be directed to `/setup` where you create your admin account by entering your name and email. A secure password is generated for you — **save it immediately** as it's shown only once.

**That's it!** Log in with your credentials and start exploring.

---

## What Happens After Installation

Once OpsKnight is running, you'll want to:

1. **Create a Service** — Represent a system you want to monitor (e.g., "Payment API")
2. **Set Up an Escalation Policy** — Define who gets notified when incidents occur
3. **Create an On-Call Schedule** — Assign team members to rotation shifts
4. **Configure Notifications** — Set up Email, SMS, Slack, or Push notifications
5. **Connect Integrations** — Route alerts from Datadog, Prometheus, or other tools

The [First Steps Guide](./getting-started/first-steps) walks you through all of these in detail.

---

## Minimum Environment Variables

At minimum, you need these environment variables configured:

```bash
# Database connection (PostgreSQL)
DATABASE_URL=postgresql://opsknight:password@localhost:5432/opsknight_db

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-32-character-secret-key-here

# Application URL (used in notification links)
APP_URL=http://localhost:3000
```

See the [Configuration Guide](./getting-started/configuration) for the complete reference.

---

## Verifying Your Installation

After starting OpsKnight, verify everything is working:

### 1. Application Loads

Navigate to `http://localhost:3000` — you should see the login page.

### 2. Login Works

Log in with your admin credentials — you should reach the dashboard.

### 3. Database Connected

Create a test service in **Services** — if it saves, the database is working.

### 4. Health Check (Optional)

```bash
curl http://localhost:3000/api/health
# Expected: {"status":"ok","database":"connected"}
```

---

## Common Issues

### Port 3000 Already in Use

```bash
# Check what's using port 3000
lsof -i :3000

# Or change the port in docker-compose.yml:
ports:
  - '3001:3000'
```

### Database Connection Failed

```bash
# Check PostgreSQL is running
docker compose logs postgres

# Reset everything and try again
docker compose down -v
docker compose up -d
```

### Login Redirects to Error Page

- Verify `NEXTAUTH_URL` matches your actual URL (including port)
- Regenerate `NEXTAUTH_SECRET` if sessions aren't persisting
- Check browser console for specific error messages

---

## Next Steps

Ready to continue? Here's your path:

1. **[Installation Guide](./getting-started/installation)** — Detailed installation for all deployment methods
2. **[Configuration Reference](./getting-started/configuration)** — Complete environment variable documentation
3. **[First Steps](./getting-started/first-steps)** — Create your first service and incident

---

## Need Help?

- Check the [GitHub Issues](https://github.com/opsknight-labs/opsknight/issues) for known problems
- Join the community Discord for real-time help
- Review the [Architecture](./architecture) section for deeper understanding
