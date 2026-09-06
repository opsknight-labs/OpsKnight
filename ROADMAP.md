# 🗺️ OpsKnight Roadmap

This roadmap outlines our path to building the ultimate open-source incident management platform.

> **Current Status:** Version 1.4.0 is the current stable release. **OpsKnight 2.0 is currently in active development** (skipping v1.5 due to 220+ merged PRs delivering massive UI, engine, and availability overhauls).

## 🏗 Phase 1: Foundation & Stability (Completed)

We have stabilized the core feature set and ensured rock-solid reliability for the V1 Release.

- [x] **Core Reliability**: Exhaustive testing of the alerting pipeline and escalation engine.
- [x] **Mobile PWA**: Polish the existing Progressive Web App (Offline support & Notifications).
- [x] **Documentation**: Comprehensive guides for APIs, deployment, and configuration.
- [x] **User Experience**: Polishing the UI/UX for Schedules and Incident Command.

## 🚀 Phase 2: Expanding Communication & ChatOps (Completed)

Expanded alerting and interactive real-time triage capabilities across modern communication platforms.

- [x] **Conference Bridge**: Auto-create Jitsi/Zoom/Google Meet rooms for incidents.
- [x] **Two-Way Slack ChatOps**: Incident war rooms, slash commands, emoji pin note syncing, and interactive command cards.
- [x] **Master Encryption Key Architecture**: 12-factor encryption key management for third-party credentials.

## 🔌 Phase 3: Ecosystem & Ingestion Hardening (Completed)

Deep APM, monitoring, and pipeline ingestion matrix across enterprise observability tools.

- [x] **SLA Engine Tier-2**: Business Hours logic, custom timezones, holiday calendars, and query-bounded rollups.
- [x] **Jira Cloud Synchronization**: Bi-directional ticket creation, real-time comment syncing, and clickable issue badges.
- [x] **24+ Native Observability Integrations**: Zabbix, PagerDuty Events v2, GitLab CI/CD, Vercel, Nagios, Icinga, Prometheus, Datadog, Grafana, Sentry, AWS CloudWatch, Azure Monitor, GCP, and more.
- [x] **Forensic Ingestion Security**: Mandatory integration key validation, timing-safe HMAC checks, and collision-resistant SHA-256 deduplication.

## 🔮 Phase 4: Intelligence & Next-Gen Automation (Upcoming)

Future milestones to make OpsKnight the smartest reliability platform in your stack.

- [ ] **One-Click Webhook Test Simulator**: In-UI test payload triggering and verification for integrations.
- [ ] **Advanced Status Pages**: Multiple independent status pages with custom domains per team/service.
- [ ] **Incident Intelligence**: AI-driven alert correlation, deduplication clustering, and automated post-mortem synthesis.
- [ ] **Custom Workflow Triggers**: Configurable multi-step state automation based on alert tags and severity thresholds.

---

Have a suggestion? [Open a Feature Request](https://github.com/opsknight-labs/OpsKnight/issues/new?template=feature_request.yml)
