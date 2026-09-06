<div align="center">

<img src="public/OpsKnight.png" alt="OpsKnight Banner" width="100%">

# OpsKnight

**Transparent, self-hosted incident operations.**<br>
_From alert ingestion and on-call routing through response, customer communication, and learning._

[**opsknight.com**](https://opsknight.com)

[![Website](https://img.shields.io/badge/Website-opsknight.com-10b981?style=flat&logo=google-chrome&logoColor=white)](https://opsknight.com)
[![Docs](https://img.shields.io/badge/Docs-Read-2563eb?style=flat&logo=book&logoColor=white)](https://opsknight.com/docs)
[![License](https://img.shields.io/badge/License-Apache_2.0-111827?style=flat)](LICENSE)
[![Docker Package](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat&logo=docker&logoColor=white)](https://github.com/opsknight-labs/OpsKnight/pkgs/container/opsknight)
[![Status](https://img.shields.io/badge/Status-v1.4.0-success?style=flat)](ROADMAP.md)
[![Next Major](https://img.shields.io/badge/Next_Major-OpsKnight_2.0_In_Development_🔥-FF5722?style=flat&logo=rocket&logoColor=white)](ROADMAP.md)
[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?style=flat&logo=github&logoColor=white)](https://github.com/sponsors/dushyant-rahangdale)
[![Tests](https://github.com/opsknight-labs/OpsKnight/actions/workflows/tests.yml/badge.svg)](https://github.com/opsknight-labs/OpsKnight/actions/workflows/tests.yml)
[![Security](https://github.com/opsknight-labs/OpsKnight/actions/workflows/security.yml/badge.svg)](https://github.com/opsknight-labs/OpsKnight/actions/workflows/security.yml)

<br>

</div>

---

> [!IMPORTANT]
> ### 🚀 OpsKnight 2.0 is coming soon!
>
> We have merged over **220+ PRs** since our last release (`v1.4.0`). While we initially planned a minor `v1.5`, the massive improvements across the board—a completely redesigned modern UI, real-time push streaming, rock-solid availability, and deep engine upgrades—mean our next milestone will be **OpsKnight 2.0**!
>
> We're putting the finishing touches on a faster, more reliable, and beautiful incident response platform.
>
> ⭐ **Star and watch this repository to stay tuned for the 2.0 release!**

---

> ### 📦 Current Stable Release: v1.4.0
>
> **Paging reliability** — delayed escalations remain delayed, orphaned work is
> recovered safely, and notification routes avoid duplicate delivery.
>
> **Operational confidence** — the administrator Health Center consolidates
> supported runtime checks, while the release contract validates installation,
> upgrades, recovery, incident delivery, deployment rendering, and stable
> AMD64/ARM64 images.
>
> [Release notes](https://github.com/opsknight-labs/OpsKnight/releases/tag/v1.4.0) ·
> [Integrations](https://opsknight.com/docs/v1.4/integrations) ·
> [Changelog](CHANGELOG.md)
>
> _v1.2 added Slack ChatOps incident war rooms —
> [setup guide](https://opsknight.com/docs/v1.4/integrations/communication/slack-chatops)._

---

## 📑 Table of Contents

- [Why OpsKnight?](#-why-opsknight)
- [Demo](#-demo)
- [Key Features](#-key-features)
- [Mobile Command Center](#-mobile-command-center)
- [Integrations](#-integrations)
- [Built With](#-built-with)
- [Quick Start](#-quick-start)
- [Container Images](#-container-images)
- [Deployment Options](#-deployment-options)
- [Architecture](#-architecture)
- [Documentation](#-documentation)
- [Security](#-security)
- [Roadmap](#-roadmap)
- [Community & Support](#-community--support)
- [Support the Project](#-support-the-project)

---

## ⚡ Why OpsKnight?

**Own the incident loop, the operational evidence, and the data.**

OpsKnight is an open-source, self-hosted alternative to per-seat on-call SaaS (including PagerDuty and Opsgenie). It is not affiliated with those companies. Designed for teams that want incident data on their own machines.

Whether you are an SRE team at a startup or a platform team at a larger organization, OpsKnight connects detect → route → respond → communicate → learn on infrastructure you control. Reliability and transparent operational evidence—not raw feature count—are the product contract.

| Feature             | OpsKnight                         | Typical per-seat SaaS        |
| :------------------ | :-------------------------------- | :--------------------------- |
| **Hosting**         | Self-hosted                       | Vendor cloud                 |
| **Software fee**    | $0 (Apache-2.0)                   | Per-user plans               |
| **Users**           | No seat meter in the product      | Per-seat pricing             |
| **Status pages**    | One page per install              | Often a separate SKU         |
| **Voice paging**    | Not included                      | Often included               |
| **Incident data**   | Your Postgres / VPC               | Vendor cloud                 |

---

## 🎥 Demo

<div align="center">
  <img src="public/demo.gif" alt="OpsKnight demo" width="100%">
</div>

---

## ✨ Key Features

<table>
  <tr>
    <td width="50%">
      <h3>🚨 Unified Command Center</h3>
      <p>Manage incidents, responders, and runbooks from a single real-time dashboard. Track SLAs (MTTA/MTTR) and automate assignments.</p>
    </td>
    <td width="50%">
      <h3>📅 Fair On-Call Rotations</h3>
      <p>Flexible scheduling with daily, weekly, or custom rotations. Handle time zones, overrides, and escalation policies with ease.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>📢 Global Escalations & War Rooms</h3>
      <p>Multi-channel notifications via <strong>Slack ChatOps, SMS, Email, and Push</strong>. Automatic Slack Incident War Rooms with 1-click triage actions.</p>
    </td>
    <td>
      <h3>📱 Mobile PWA</h3>
      <p>Full incident management in your pocket. Installable on iOS/Android with <strong>Push Notifications</strong> and biometric security.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>📊 Public Status Pages</h3>
      <p>Keep your users informed with beautiful public status pages. Automate updates and subscriber notifications during incidents.</p>
    </td>
    <td>
      <h3>🔌 22+ Native Integrations</h3>
      <p>Native parsers for Prometheus, Datadog, Sentry, CloudWatch, Grafana, Zabbix, GitLab, Vercel, Jira Cloud sync, and Events API v2 ingest.</p>
    </td>
  </tr>
</table>

---

## 📱 Mobile Command Center

**Respond to incidents from anywhere.** OpsKnight includes a fully installable Progressive Web App (PWA) for iOS and Android.

- **🔔 Push Notifications**: Get critical alerts instantly on your device.
- **👆 One-Tap Install**: No App Store required. Just "Add to Home Screen".
- **🔒 Secure**: Supports biometric authentication (FaceID/TouchID).

<div align="center">
  <img src="docs/v1.4/assets/mobile.png" alt="Mobile Dashboard" width="100%">
</div>

<div align="center">
  <a href="docs/v1.4/mobile/setup.md"><strong>Explore Mobile Setup Guide →</strong></a>
</div>

---

## 🔌 Integrations

OpsKnight plays nicely with your entire observability and engineering stack.

<div align="center">
  <img src="https://img.shields.io/badge/Slack_ChatOps-4A154B?style=for-the-badge&logo=slack&logoColor=white" alt="Slack" />
  <img src="https://img.shields.io/badge/Jira_Cloud-0052CC?style=for-the-badge&logo=jira&logoColor=white" alt="Jira Cloud" />
  <img src="https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white" alt="Prometheus" />
  <img src="https://img.shields.io/badge/Datadog-632CA6?style=for-the-badge&logo=datadog&logoColor=white" alt="Datadog" />
  <img src="https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white" alt="Grafana" />
  <img src="https://img.shields.io/badge/Sentry-362D59?style=for-the-badge&logo=sentry&logoColor=white" alt="Sentry" />
  <img src="https://img.shields.io/badge/AWS_CloudWatch-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white" alt="CloudWatch" />
  <img src="https://img.shields.io/badge/Zabbix-D40000?style=for-the-badge&logo=zabbix&logoColor=white" alt="Zabbix" />
  <img src="https://img.shields.io/badge/PagerDuty-0052CC?style=for-the-badge&logo=pagerduty&logoColor=white" alt="PagerDuty" />
  <img src="https://img.shields.io/badge/GitLab-FC6D26?style=for-the-badge&logo=gitlab&logoColor=white" alt="GitLab" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
  <img src="https://img.shields.io/badge/Generic_Webhooks-000000?style=for-the-badge&logo=webhook&logoColor=white" alt="Webhooks" />
</div>

[**View All 22+ Integrations →**](docs/v1.4/integrations/README.md)

---

## 🛠️ Built With

OpsKnight is built on a modern, type-safe stack designed for performance and developer experience.

<div align="center">
  <img src="https://img.shields.io/badge/Next.js_15-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React_19-20232a?style=for-the-badge&logo=react&logoColor=61dafb" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</div>

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Git
- `openssl` (ships with macOS and most Linux distributions)

### Run the full stack

```bash
# 1. Clone the repository
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight

# 2. Create your environment file
cp env.example .env

# 3. Generate the two secrets OpsKnight requires
printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> .env
printf 'ENCRYPTION_KEY=%s\n'  "$(openssl rand -hex 32)"    >> .env

# 4. Start OpsKnight and PostgreSQL
docker compose up -d
```

Open **http://localhost:3000**. The database schema is created on first boot, so
there is no migration step to run yourself.

`ENCRYPTION_KEY` encrypts integration credentials at rest — **keep it safe and
back it up.** Losing it means re-entering every integration secret.

> **Before exposing this to a network**, change the default PostgreSQL password in
> `.env` and set `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` to your real hostname.

### Bring your own database

To run the published image against your own PostgreSQL, rather than the bundled one:

```bash
docker run -d --name opsknight -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:password@your-db-host:5432/opsknight" \
  -e NEXTAUTH_URL="https://opsknight.example.com" \
  -e NEXT_PUBLIC_APP_URL="https://opsknight.example.com" \
  -e NEXTAUTH_SECRET="$(openssl rand -base64 32)" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  ghcr.io/opsknight-labs/opsknight:latest
```

PostgreSQL 14+ is required. See the
[deployment guides](docs/v1.5/deployment/README.md) for TLS, connection pooling
and scaling.

---

## 🐳 Container Images

Images are published to the GitHub Container Registry and are **public — no
authentication needed to pull**.

| Image                                   | Channel                        | Tags                          |
| :-------------------------------------- | :----------------------------- | :---------------------------- |
| `ghcr.io/opsknight-labs/opsknight`      | Stable releases                | `1.4.0`, `1.4`, `1`, `latest` |
| `ghcr.io/opsknight-labs/opsknight-test` | Pre-release, built from `main` | `latest`, `sha-<commit>`      |

```bash
# Pin a release — recommended for production
docker pull ghcr.io/opsknight-labs/opsknight:1.4.0

# Or track the latest stable release
docker pull ghcr.io/opsknight-labs/opsknight:latest
```

Pinning an exact version is strongly preferred in production: `latest` moves
whenever a release ships, so a container restart can change versions underneath you.

[Browse all published versions →](https://github.com/opsknight-labs/OpsKnight/pkgs/container/opsknight)

---

## 📦 Deployment Options

We support multiple deployment strategies to fit your infrastructure needs.

| Method                                                                                                        | Best For                            | Guide                                            |
| :------------------------------------------------------------------------------------------------------------ | :---------------------------------- | :----------------------------------------------- |
| ![](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white) **Docker Compose**     | Local Development, small teams      | [Read Guide](docs/v1.5/deployment/docker.md)     |
| ![](https://img.shields.io/badge/Kubernetes-326CE5?style=flat&logo=kubernetes&logoColor=white) **Helm Chart** | Production Kubernetes (Recommended) | [Read Guide](docs/v1.5/deployment/helm.md)       |
| ![](https://img.shields.io/badge/-GitOps-black?style=flat&logo=git&logoColor=white) **Kustomize**             | GitOps (ArgoCD/Flux)                | [Read Guide](docs/v1.5/deployment/kubernetes.md) |

> **Note:** For production, we recommend using an external managed PostgreSQL database.

---

## 🏗️ Architecture

OpsKnight runs as a single Next.js application (UI + API routes + server actions) with an internal DB-backed scheduler and a Postgres-backed job queue.

<div align="center">
  <img src="docs/v1.4/assets/images/opsknight-architecture.svg" alt="OpsKnight architecture diagram" width="100%">
  <sub><em>High-level architecture: clients → app (Next.js) → PostgreSQL (Prisma) → outbound channels.</em></sub>
</div>

- Full details: [Architecture docs](docs/v1.4/architecture/README.md)

---

## 📚 Documentation

Everything you need to configure and extend OpsKnight.

- **[Hosted Documentation](https://opsknight.com/docs)** (Recommended)
- **In-Repo Guides (v1.5)**:
  - [⚡ Getting Started](docs/v1.5/getting-started/README.md)
  - [🧩 Core Concepts](docs/v1.5/core-concepts/README.md)
  - [🔌 Integrations](docs/v1.5/integrations/README.md)
  - [🛡️ Security](docs/v1.5/security/README.md)
  - [📡 API Reference](docs/v1.5/api/README.md)
  - [🔧 Administration](docs/v1.5/administration/README.md)
  - [📈 Prometheus Metrics](docs/v1.5/deployment/prometheus.md)

---

## 🔒 Security

OpsKnight handles on-call rotations, integration credentials and incident data, so
security is treated as a first-class concern:

- Integration secrets are **encrypted at rest** with envelope encryption, keyed by `ENCRYPTION_KEY`
- Inbound webhooks and Slack requests are **signature-verified and rejected when they cannot be verified** — there is no fail-open path
- Every push is scanned by CodeQL, Trivy, TruffleHog, Checkov and OWASP ZAP in CI
- RBAC governs incident, service and schedule access

Found a vulnerability? Please **do not** open a public issue — see
[SECURITY.md](SECURITY.md) for private disclosure.

Hardening guidance: [Security documentation](docs/v1.4/security/README.md)

---

## 🗺️ Roadmap

🔥 **Currently In Active Development: OpsKnight 2.0 (Next Major Evolution)**

- [x] Core Incident Management & On-Call Schedules
- [x] **Slack ChatOps Incident War Rooms & Interactive Cards**
- [x] **Native inbound parsers** (catalog size in docs; includes Events API v2 ingest, GitLab, Vercel, Nagios, Icinga, Datadog, Prometheus, etc.)
- [x] **Forensic Webhook Ingestion Security & Mandatory Key Authentication**
- [x] **Master Encryption Key Architecture (12-Factor Security)**
- [x] **Tier-2 SLA Engine Hardening & Custom Business Hours**
- [x] **Jira Cloud Bi-Directional Synchronization & Real-Time Note Sync**
- [x] **Public Status Pages with Subscriber Notifications**
- [x] **Mobile PWA with Biometric Security & Push Notifications**
- [x] **Administrator Health Center & Release-Quality Contract**
- [x] **Reliable Delayed Escalation Recovery & Multi-Architecture Releases**
- [ ] 🚀 **OpsKnight 2.0: Redesigned UI, real-time push engine, and availability hardening**

See the full [ROADMAP.md](ROADMAP.md)

---

## 🤝 Community & Support

**We are actively seeking contributors!** Whether you're a developer, designer, or technical writer, come help us build OpsKnight.

<div align="center">
  <a href="mailto:help@opsknight.com">
    <img src="https://img.shields.io/badge/Email-help%40opsknight.com-blue?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" />
  </a>
  <a href="https://github.com/opsknight-labs/OpsKnight/discussions">
    <img src="https://img.shields.io/badge/GitHub-Discussions-24292e?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Discussions" />
  </a>
  <a href="https://github.com/opsknight-labs/OpsKnight/issues">
    <img src="https://img.shields.io/badge/Issues-Report%20Bug-d73a49?style=for-the-badge&logo=github&logoColor=white" alt="Report Bug" />
  </a>
  <a href="CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen?style=for-the-badge&logo=git&logoColor=white" alt="PRs Welcome" />
  </a>
</div>

We love contributors! Please check our [Contributing Guide](CONTRIBUTING.md) to get started.

---

## ❤️ Support the Project

OpsKnight is an independent open-source project. If it helps you sleep better at night, consider supporting its development.

- **🌟 Star the repo**: It helps others find us.
- **💝 Sponsor**: [Become a Sponsor](https://github.com/sponsors/dushyant-rahangdale)

Built with ❤️ by [Dushyant Rahangdale](https://github.com/dushyant-rahangdale)

<br>

<p align="center">
  <a href="https://github.com/opsknight-labs/OpsKnight/stargazers">
    <img src="https://img.shields.io/github/stars/opsknight-labs/OpsKnight?style=for-the-badge&logo=github&color=10b981&logoColor=white" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/opsknight-labs/OpsKnight/network/members">
    <img src="https://img.shields.io/github/forks/opsknight-labs/OpsKnight?style=for-the-badge&logo=github&color=06b6d4&logoColor=white" alt="GitHub Forks" />
  </a>
  <a href="https://github.com/opsknight-labs/OpsKnight/issues">
    <img src="https://img.shields.io/github/issues/opsknight-labs/OpsKnight?style=for-the-badge&logo=github&color=8b5cf6&logoColor=white" alt="GitHub Issues" />
  </a>
</p>
