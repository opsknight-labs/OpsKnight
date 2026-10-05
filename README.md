<div align="center">

<a href="https://opsknight.com/">
  <img src="public/readme/hero.webp" alt="OpsKnight Command Center on desktop with the responder PWA in light and dark mode" width="100%">
</a>

<h3>Open-source incident management and on-call — on infrastructure you control.</h3>

<p>Detect, route, page, respond, communicate and learn in one self-hosted platform.<br>
No per-seat pricing. Your incident data stays in your own database.</p>

<p>
  <a href="https://github.com/opsknight-labs/OpsKnight/releases/tag/v2.0.0"><img src="https://img.shields.io/badge/release-v2.0.0-e11d48?style=for-the-badge" alt="Release v2.0.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0--only-111827?style=for-the-badge" alt="License AGPL-3.0-only"></a>
  <a href="https://github.com/opsknight-labs/OpsKnight/pkgs/container/opsknight"><img src="https://img.shields.io/badge/ghcr.io-amd64%20%7C%20arm64-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Multi-architecture container on GHCR"></a>
  <a href="https://opsknight.com/docs/v2.0.0/"><img src="https://img.shields.io/badge/docs-opsknight.com-2563eb?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation"></a>
</p>
<p>
  <a href="https://github.com/opsknight-labs/OpsKnight/actions/workflows/tests.yml"><img src="https://github.com/opsknight-labs/OpsKnight/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/opsknight-labs/OpsKnight/actions/workflows/security.yml"><img src="https://github.com/opsknight-labs/OpsKnight/actions/workflows/security.yml/badge.svg" alt="Security"></a>
  <a href="https://github.com/sponsors/dushyant-rahangdale"><img src="https://img.shields.io/badge/sponsor-%E2%9D%A4-ea4aaa?style=flat&logo=githubsponsors&logoColor=white" alt="Sponsor"></a>
</p>

**[Website](https://opsknight.com/)** &nbsp;·&nbsp; **[Documentation](https://opsknight.com/docs/v2.0.0/)** &nbsp;·&nbsp; **[Quick start](#-quick-start)** &nbsp;·&nbsp; **[Watch product tour (3:34)](https://youtu.be/tE3Y1R4Hteg)** &nbsp;·&nbsp; **[What's new in 2.0](#-whats-new-in-20)** &nbsp;·&nbsp; **[Sponsor](https://github.com/sponsors/dushyant-rahangdale)**

</div>

---

## 🧭 Product tour

See how OpsKnight connects alert ingestion, incident response, on-call, escalation, ChatOps, customer communication, analytics and post-incident learning.

<p align="center">
  <a href="https://youtu.be/tE3Y1R4Hteg" title="Watch full OpsKnight product walkthrough on YouTube">
    <img src="public/readme/product-tour.webp" alt="OpsKnight product walkthrough: alert triage, incident response, on-call schedules, war rooms, public status, and postmortems" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/tE3Y1R4Hteg"><strong>Watch the full 3:34 tour on YouTube →</strong></a> &nbsp;·&nbsp; <a href="#-quick-start"><strong>Get started in Docker →</strong></a>
</p>

---

## 🧩 Everything in the incident loop

<table>
<tr>
<td width="33%" valign="top">

### 🚨 Detect & Route

Authenticated inbound integrations with service-bound routing, provider-specific urgency mapping, deduplication and recovery handling.

</td>
<td width="33%" valign="top">

### ⚡ Respond

Unified incident workspace with ownership handoffs, real-time activity timelines, response health SLA timers, action items, and 5-Whys postmortems.

</td>
<td width="33%" valign="top">

### 📅 On-call & Escalate

Multi-layer rotation schedules with DST-safe handoffs, temporary overrides, and escalation policies targeting users, schedules, and teams.

</td>
</tr>
<tr>
<td valign="top">

### 📣 Notify & Coordinate

Multi-channel paging across Web Push, email, SMS, WhatsApp, and interactive Twilio voice with durable retries and delivery evidence.

</td>
<td valign="top">

### 🌐 Communicate

One configurable public or private status page with service health, incidents, maintenance, subscriber notifications, uptime history and publishable postmortems.

</td>
<td valign="top">

### 📊 Analyze & Learn

Actionable reliability metrics including MTTA, MTTR, SLA compliance tracking, configurable dashboards, NOC/TV mode, and browser print/PDF export.

</td>
</tr>
</table>

---

## 🚀 Quick start

Prerequisites: Git, Docker with Docker Compose, and `openssl`.

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight

cat << 'EOF' > .env
OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0
POSTGRES_USER=opsknight
POSTGRES_DB=opsknight_db
POSTGRES_PORT=5432
APP_PORT=3000
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF

printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env
printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> .env
printf 'API_KEY_SECRET=%s\n' "$(openssl rand -base64 32)" >> .env
printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" >> .env

docker compose --env-file .env -f deploy/compose/docker-compose.yml pull
docker compose --env-file .env -f deploy/compose/docker-compose.yml up -d --wait

docker compose --env-file .env -f deploy/compose/docker-compose.yml exec -T opsknight-app \
  node scripts/create-bootstrap-code.mjs
```

Open `http://localhost:3000/setup`, enter the short-lived bootstrap code, and create the first administrator.

> [!IMPORTANT]
> Before exposing OpsKnight, configure its public URL and keep `NEXTAUTH_SECRET`, `API_KEY_SECRET` and the encryption key outside source control. They must stay stable across restarts, upgrades and restores — losing the encryption key makes stored provider credentials unreadable. Production startup rejects placeholder and reused secrets.

[Production installation →](https://opsknight.com/docs/v2.0.0/start/production-install/) &nbsp;·&nbsp; [Upgrading from 1.x →](https://opsknight.com/docs/v2.0.0/start/migrate-from-v1/)

---

## 🖥️ Inside OpsKnight

### Incident Operations

Command Center gives responders real-time operational pulse across active incidents, open alerts, team workload, and approaching SLA breaches.

<p align="center">
  <img src="public/readme/command-center.webp" alt="OpsKnight Command Center displaying live triage, active alerts, workload distribution, and SLA countdowns" width="100%">
</p>

Responders get ownership, notes, watchers, action items, SLA timers and a live incident timeline in one workspace.

<p align="center">
  <img src="public/readme/incident-response.webp" alt="OpsKnight incident response workspace showing responder ownership, contextual timeline, SLA targets, and action items" width="100%">
</p>

### On-call & Reliability

Manage rotation layers, live coverage, DST-safe handoffs, temporary overrides and multi-tier escalation.

<p align="center">
  <img src="public/readme/platform.webp" alt="OpsKnight reliability platform: on-call schedule layers, escalation policy designer, and SLA performance metrics" width="100%">
</p>

### 🌐 Communicate with customers

Publish service health, incidents, maintenance, uptime history and post-incident reviews from the same incident workflow.

<p align="center">
  <img src="public/readme/status-page.webp" alt="OpsKnight public status page displaying real-time system status, operational services, uptime history, and active incident announcements" width="100%">
</p>

### 📱 Mobile responder PWA — light and dark, iOS and Android

<p align="center">
  <img src="public/readme/mobile.webp" alt="OpsKnight mobile PWA on iPhone: responder home and incident triage in light mode, push notifications on the lock screen, incident response and on-call in dark mode" width="100%">
</p>

Install OpsKnight from the browser to get a mobile-first workspace for incidents, on-call, escalation policies, services, teams, status, analytics and postmortems. Push registration is per device, the app follows the system light or dark theme, and offline actions stay authorization-bound when they replay. [Set up the mobile PWA →](https://opsknight.com/docs/v2.0.0/guides/mobile/)

---

## ✨ What's new in 2.0

<table>
<tr>
<td width="50%" valign="top">

**🧱 Split production runtime**<br>
Web, Scheduler, General / Critical / Bulk Workers and Status Projector scale and fail independently. The integrated runtime stays supported.

**📣 Notification control plane**<br>
Durable delivery intents, retries, provider capacity and per-attempt evidence for email, Web Push, SMS, WhatsApp and voice.

**📞 Twilio voice paging**<br>
Triggered incidents can call responders, who acknowledge from the keypad.

</td>
<td width="50%" valign="top">

**💬 Microsoft Teams ChatOps**<br>
Adaptive Cards, interactive incident actions, war rooms and meetings — alongside reworked Slack war rooms and Jira sync.

**🛡️ Identity and governance**<br>
SCIM 2.0 Users and Groups, OIDC claim-to-role mapping, an Auditor role, session registry and privacy/DSAR workflows.

**🐳 Docker Swarm and deployment planning**<br>
Integrated and split stacks for Compose, Swarm, Helm and Kustomize, with workload profiles and repeatable load/correctness testing for deployment planning.

</td>
</tr>
</table>

<p align="center"><a href="CHANGELOG.md">Read the full 2.0 changelog →</a></p>

---

## 🔌 Integrations

<p align="center">
  <img src="https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white" alt="Prometheus">
  <img src="https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white" alt="Grafana">
  <img src="https://img.shields.io/badge/Datadog-632CA6?style=for-the-badge&logo=datadog&logoColor=white" alt="Datadog">
  <img src="https://img.shields.io/badge/Sentry-362D59?style=for-the-badge&logo=sentry&logoColor=white" alt="Sentry">
  <img src="https://img.shields.io/badge/AWS_CloudWatch-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white" alt="AWS CloudWatch">
  <img src="https://img.shields.io/badge/Azure_Monitor-0078D4?style=for-the-badge&logo=microsoftazure&logoColor=white" alt="Azure Monitor">
  <br>
  <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  <img src="https://img.shields.io/badge/GitLab-FC6D26?style=for-the-badge&logo=gitlab&logoColor=white" alt="GitLab">
  <img src="https://img.shields.io/badge/Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white" alt="Slack">
  <img src="https://img.shields.io/badge/Microsoft_Teams-6264A7?style=for-the-badge&logo=microsoftteams&logoColor=white" alt="Microsoft Teams">
  <img src="https://img.shields.io/badge/Jira-0052CC?style=for-the-badge&logo=jira&logoColor=white" alt="Jira">
  <img src="https://img.shields.io/badge/Webhooks-111827?style=for-the-badge&logo=webhooks&logoColor=white" alt="Generic webhooks">
</p>

Monitoring, cloud, uptime, CI/CD, ChatOps, ticketing, notification and identity providers each have a documented contract for authentication, lifecycle actions and recovery. [Browse the integration catalog →](https://opsknight.com/docs/v2.0.0/integrations/)

---

## 🏗️ Deploy anywhere

|                                                                                                              | Topology                         | Best for                    | Guide                                                                                |
| :----------------------------------------------------------------------------------------------------------- | :------------------------------- | :-------------------------- | :----------------------------------------------------------------------------------- |
| <img src="https://img.shields.io/badge/-Compose-2496ED?style=flat&logo=docker&logoColor=white" alt="">       | Integrated or split, single host | Evaluation and small teams  | [Docker Compose →](https://opsknight.com/docs/v2.0.0/operate/deploy/docker-compose/) |
| <img src="https://img.shields.io/badge/-Swarm-2496ED?style=flat&logo=docker&logoColor=white" alt="">         | Integrated or split across nodes | Multi-node Docker estates   | [Docker Swarm →](https://opsknight.com/docs/v2.0.0/operate/deploy/swarm/)            |
| <img src="https://img.shields.io/badge/-Helm-0F1689?style=flat&logo=helm&logoColor=white" alt="">            | Schema-validated chart           | Production Kubernetes       | [Helm →](https://opsknight.com/docs/v2.0.0/operate/deploy/helm/)                     |
| <img src="https://img.shields.io/badge/-Kustomize-326CE5?style=flat&logo=kubernetes&logoColor=white" alt=""> | Bases and overlays               | GitOps with Argo CD or Flux | [Kustomize →](https://opsknight.com/docs/v2.0.0/operate/deploy/kustomize/)           |

PostgreSQL 14 or later is required. For production, pin the tested multi-architecture image digest, size the database connection budget and complete the topology's acceptance checklist. [Choose a topology →](https://opsknight.com/docs/v2.0.0/operate/deploy/) · [Plan capacity →](https://opsknight.com/docs/v2.0.0/operate/capacity/choose-deployment/)

### Architecture

<p align="center">
  <img src="public/readme/architecture.svg" alt="OpsKnight integrated and split runtime architecture" width="100%">
</p>

Integrated mode runs Web and background work in one process. Split mode gives Web, Scheduler, General Worker, Critical Worker, Bulk Worker and Status Projector explicit ownership so they scale and fail independently. Both use PostgreSQL for durable state and work coordination; only Web receives ingress. [Read the architecture guide →](https://opsknight.com/docs/v2.0.0/operate/deploy/architecture/)

---

## 🤔 Why OpsKnight?

|                   | **OpsKnight**                                                 | Typical per-seat SaaS   |
| :---------------- | :------------------------------------------------------------ | :---------------------- |
| **Where it runs** | Your infrastructure                                           | Vendor cloud            |
| **Incident data** | Stays in your PostgreSQL                                      | Stored by the vendor    |
| **Pricing**       | No seat meter, no software fee                                | Per-user plans          |
| **Source**        | Open under AGPL-3.0-only                                      | Closed                  |
| **Operations**    | Source-visible runtime, health, metrics and delivery evidence | Vendor-operated runtime |

OpsKnight is an independent project and is not affiliated with PagerDuty, Opsgenie or other vendors.

---

## 🔒 Security

Encrypted provider credentials with key rotation, independent session and API-key signing secrets, fail-closed inbound verification, role-based authorization, session revocation, OIDC, SCIM, audit evidence and CI security scanning. Compliance tooling helps operators implement and evidence controls; it does not itself confer certification.

[Security policy](SECURITY.md) &nbsp;·&nbsp; [Production hardening](https://opsknight.com/docs/v2.0.0/operate/security/hardening/) &nbsp;·&nbsp; [Report a vulnerability privately](https://github.com/opsknight-labs/OpsKnight/security/advisories/new)

---

## 📚 Documentation

The versioned 2.0 documentation is the source of truth for product behavior, configuration, deployment, integrations and operations.

| [**Get started**](https://opsknight.com/docs/v2.0.0/start/) | [**Guides**](https://opsknight.com/docs/v2.0.0/guides/) | [**Operate**](https://opsknight.com/docs/v2.0.0/operate/) | [**API reference**](https://opsknight.com/docs/v2.0.0/reference/api/) | [**Troubleshooting**](https://opsknight.com/docs/v2.0.0/troubleshooting/) |
| :---------------------------------------------------------: | :-----------------------------------------------------: | :-------------------------------------------------------: | :-------------------------------------------------------------------: | :-----------------------------------------------------------------------: |
|                 Install and first incident                  |                  Day-to-day workflows                   |                  Deploy, scale, upgrade                   |                           REST API and keys                           |                           Diagnose and recover                            |

---

## 🤝 Community

Bug reports, focused feature requests, documentation fixes and code contributions are welcome.

<p align="center">
  <a href="https://github.com/opsknight-labs/OpsKnight/discussions"><img src="https://img.shields.io/badge/GitHub-Discussions-24292e?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Discussions"></a>
  <a href="https://github.com/opsknight-labs/OpsKnight/issues"><img src="https://img.shields.io/badge/Issues-Report_a_bug-d73a49?style=for-the-badge&logo=github&logoColor=white" alt="Report a bug"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-Welcome-22c55e?style=for-the-badge&logo=git&logoColor=white" alt="Contributing guide"></a>
  <a href="ROADMAP.md"><img src="https://img.shields.io/badge/Roadmap-View-6366f1?style=for-the-badge&logo=target&logoColor=white" alt="Roadmap"></a>
</p>

### 💖 Sustain OpsKnight

OpsKnight is independently maintained. Sponsorship funds open-source development, release infrastructure, security maintenance and documentation.

<p align="center">
  <a href="https://github.com/sponsors/dushyant-rahangdale"><img src="https://img.shields.io/badge/Sponsor_OpsKnight-GitHub_Sponsors-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor OpsKnight on GitHub Sponsors"></a>
</p>

---

## 📄 License

OpsKnight 2.0 is distributed under [`AGPL-3.0-only`](LICENSE). OpsKnight 1.4.0 and earlier remain available under the licenses they were published with; see [LICENSE-TRANSITION.md](LICENSE-TRANSITION.md).

<div align="center">
<br>
<a href="https://opsknight.com/"><img src="public/logo.png" alt="OpsKnight" width="56"></a>
<br>
<sub>Built for the people who answer the page.</sub>
</div>
