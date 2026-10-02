<div align="center">

<img src="public/OpsKnight.png" alt="OpsKnight Banner" width="100%">

# OpsKnight 2.0.0

**Self-hosted incident management and on-call operations.**<br>
_Detect, route, respond, communicate, and learn on infrastructure you control._

[**Website**](https://opsknight.com) · [**Documentation**](https://opsknight.com/docs/latest/) · [**Upgrade from 1.4**](https://opsknight.com/docs/latest/start/migrate-from-v1/)

[![License](https://img.shields.io/badge/License-AGPL--3.0--only-111827?style=flat)](LICENSE)
[![Release](https://img.shields.io/badge/Release-v2.0.0-success?style=flat)](https://github.com/opsknight-labs/OpsKnight/releases/tag/v2.0.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat&logo=docker&logoColor=white)](https://github.com/opsknight-labs/OpsKnight/pkgs/container/opsknight)
[![Tests](https://github.com/opsknight-labs/OpsKnight/actions/workflows/tests.yml/badge.svg)](https://github.com/opsknight-labs/OpsKnight/actions/workflows/tests.yml)
[![Security](https://github.com/opsknight-labs/OpsKnight/actions/workflows/security.yml/badge.svg)](https://github.com/opsknight-labs/OpsKnight/actions/workflows/security.yml)

</div>

## What ships in 2.0

OpsKnight 2.0 is a major architecture and operations release:

- **Split-runtime, HA-ready deployment:** run Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector independently, or retain the integrated runtime. Compose, Swarm, Helm, and Kustomize cover supported integrated and split patterns with external PostgreSQL and optional PgBouncer.
- **Notification delivery control plane:** durable logical intents, traffic lanes, provider attempts, retry and terminal states, callback reconciliation, capacity admission, and administrator delivery evidence across email, web push, SMS, WhatsApp, and Twilio voice paging.
- **Interactive Microsoft Teams ChatOps:** Entra/Azure Bot setup, Teams app packaging, Adaptive Cards, incident actions, responder identity linking, war rooms, participant synchronization, and meeting collaboration. Slack ChatOps and Jira synchronization are also substantially hardened.
- **Incident response policy engine:** workspace- and service-scoped classification, SLA, and support-hours policies with immutable published versions, preview, history, diff, restore, and API access.
- **Identity and access:** SCIM 2.0 Users and Groups provisioning, stronger OIDC provider flows and claim mapping, the read-oriented `AUDITOR` role, API keys, and signed-in session/device inspection with individual or global revocation.
- **Security, privacy, and compliance operations:** privacy-request workflows, retention holds, encryption migration controls, technical control evaluation, framework mapping, evidence ledgers, drift monitoring, and verifiable evidence-package exports. These tools support audits; they do not confer SOC 2, ISO, or other certification.
- **Responder-grade mobile PWA:** rebuilt mobile navigation and response workflows, per-device push state, repair flows, offline boundaries, update handling, and hardened iOS PWA lifecycle behavior.
- **Status Page V3:** one supported status page with themes, announcements, subscriber verification, API tokens, webhooks, privacy controls, uptime history/export, and hardened public routing.
- **Custom dashboards and NOC wallboards:** templates, configurable widgets and layout, visibility controls, filtered share links, PDF export, live refresh, and fullscreen presentation mode.
- **Benchmark-driven deployment planning:** Small, Medium, Large, and Storm workload shapes plus load/correctness certification guide topology and capacity decisions.

The core response experience is also rebuilt around a centralized incident lifecycle, stronger schedules and escalation recovery, manual incident creation, templates, action items, 5-Whys postmortems, critical-incident awareness, personal Quiet Hours for low-urgency notifications, and multi-destination Slack/Teams routing. Medium- and high-urgency operational paging bypasses Quiet Hours.

OpsKnight 2.0 certifies **28 current inbound integration contracts**; this is the total supported contract set, not 28 additions since 1.4. ManageEngine is the new native inbound parser, while the existing monitoring integrations receive stronger authentication, recovery, deduplication, and error contracts.

The certified feature, API, configuration, integration, and operational contracts live in the [2.0 documentation](https://opsknight.com/docs/latest/). Treat those docs as the source of truth for supported behavior.

## Quick start

Prerequisites: Docker, Docker Compose, and `openssl`.

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight
cp env.example .env

printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> .env
printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" >> .env

OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0 \
  docker compose -f deploy/compose/docker-compose.yml pull
OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0 \
  docker compose -f deploy/compose/docker-compose.yml up -d

# Create the short-lived one-time code required by the setup form.
docker compose -f deploy/compose/docker-compose.yml exec -T opsknight-app \
  node scripts/create-bootstrap-code.mjs
```

Open `http://localhost:3000/setup`, enter the printed one-time bootstrap code, and complete the first-administrator flow before the code expires. Before exposing the service, set the public Application URL, replace all example database credentials, and store `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` in your secret manager. Losing `ENCRYPTION_KEY` makes encrypted provider credentials unreadable.

For production, pin the tested multi-architecture image digest rather than a moving tag and follow the [production installation guide](https://opsknight.com/docs/latest/start/production-install/).

## Deployment choices

| Method | Best fit | Guide |
| --- | --- | --- |
| Docker Compose | Evaluation, single-host, and smaller installations | [Compose](https://opsknight.com/docs/latest/operate/deploy/compose/) |
| Docker Swarm | Swarm clusters, integrated or split runtime | [Swarm](https://opsknight.com/docs/latest/operate/deploy/swarm/) |
| Helm | Production Kubernetes | [Helm](https://opsknight.com/docs/latest/operate/deploy/helm/) |
| Kustomize | GitOps-managed Kubernetes | [Kustomize](https://opsknight.com/docs/latest/operate/deploy/kustomize/) |

Review the [deployment planner](https://opsknight.com/docs/latest/operate/deploy/) and [capacity guidance](https://opsknight.com/docs/latest/operate/capacity/choose-deployment/) before selecting a topology. PostgreSQL 14 or later is required. PgBouncer is supported only in the documented transaction-pooling pattern; migrations and runtime roles that need session semantics connect directly to PostgreSQL.

## Upgrading from 1.4

OpsKnight 2.0 is a major upgrade and the first stable AGPL-3.0-only release.

1. Back up the database and verify a restore before the maintenance window.
2. Preserve `ENCRYPTION_KEY` and `NEXTAUTH_SECRET` exactly.
3. Configure and verify the public Application URL.
4. Run migrations against direct PostgreSQL, never through PgBouncer.
5. Choose integrated or split topology and validate capacity before cutover.
6. Test notification providers, inbound integrations, ChatOps, and paging.
7. Record the rollback boundary before accepting writes on 2.0.

Follow [Migrate from v1](https://opsknight.com/docs/latest/start/migrate-from-v1/), [database migrations](https://opsknight.com/docs/latest/operate/upgrades/database-migrations/), and [rollback](https://opsknight.com/docs/latest/operate/upgrades/rollback/) in full.

## Container images

The public stable image is:

```text
ghcr.io/opsknight-labs/opsknight:2.0.0
```

The release workflow also publishes `2.0`, `2`, `latest`, and `sha-…` aliases plus SBOM and provenance. Production deployments should pin the verified manifest digest published with the release. The `opsknight-test` package is a pre-release channel built from `main`; do not use it as a stable production dependency.

## Technology

OpsKnight 2.0 uses Next.js 16.3.8, React 19, TypeScript, Prisma, PostgreSQL, and container-native deployment tooling.

## Security and license

New OpsKnight 2.0 material is distributed under [`AGPL-3.0-only`](LICENSE). OpsKnight 1.4.0 and earlier remain available under the licenses under which they were published; see [LICENSE-TRANSITION.md](LICENSE-TRANSITION.md).

Security controls include encrypted provider credentials, fail-closed inbound signature verification, role-based authorization, session revocation, audit evidence, and CI security scanning. For private vulnerability reporting and the supported-version policy, see [SECURITY.md](SECURITY.md).

## Community

- [Discussions](https://github.com/opsknight-labs/OpsKnight/discussions)
- [Issues](https://github.com/opsknight-labs/OpsKnight/issues)
- [Contributing guide](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)
- [Sponsor](https://github.com/sponsors/dushyant-rahangdale)
