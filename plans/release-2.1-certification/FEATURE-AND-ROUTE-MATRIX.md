# OpsKnight 2.1 — Feature and Route Inventory Matrix

**Candidate Commit SHA:** `abede9203d257fafeff8c4d19ef23dc269bc8274`  
**Certified Version:** OpsKnight 2.1.0  
**Inspection Date:** 2026-10-26  
**Auditor:** Release Engineering, SRE & QA Architecture

---

## 1. Executive Capability Scope Summary

This inventory documents all shipped Next.js web application surfaces, REST API v2 endpoints, public status surfaces, mobile PWA routes, and operational maintenance surfaces for OpsKnight 2.1.

| Domain Area                | Shipped Routes                                     | Primary Roles    | CRUD Support | Automated Coverage Status                 | Release Classification                |
| -------------------------- | -------------------------------------------------- | ---------------- | ------------ | ----------------------------------------- | ------------------------------------- |
| **Incident Management**    | `/incidents`, `/[id]`, `/create`, `/templates`     | Admin, Responder | Full C/R/U/D | Playwright E2E + REST API Matrix (100%)   | **Supported (GA)**                    |
| **Service Catalog**        | `/services`, `/[id]`, `/settings`, `/integrations` | Admin, Responder | Full C/R/U/D | Component Tests + REST Matrix (100%)      | **Supported (GA)**                    |
| **Service Automation**     | `/services/[id]/automations`, `/[ruleId]`          | Admin            | Full C/R/U/D | E2E + Unit (Shadow, First-Match, Trace)   | **Supported (GA)**                    |
| **Escalation Policies**    | `/policies`, `/[id]`, `/create`                    | Admin, Team Lead | Full C/R/U/D | E2E + Multi-step Matrix                   | **Supported (GA)**                    |
| **On-Call Schedules**      | `/schedules`, `/[id]`                              | Admin, Responder | Full C/R/U/D | Timezone/DST Integration + UI Tests       | **Supported (GA)**                    |
| **Teams & Users**          | `/teams`, `/users`, `/[id]`                        | Admin            | Full C/R/U/D | Admin E2E + RBAC Isolation                | **Supported (GA)**                    |
| **Runbook Engine**         | `/runbooks`, `/agents`, `/executions`              | Admin, Responder | Full C/R/U/D | Playwright Matrix + Remote Agent Protocol | **Supported (GA - Certified Scope)**  |
| **Status Platform**        | `/status`, `/[slug]`, `/settings/status-pages`     | Admin, Public    | Full C/R/U/D | Public Isolation + Subscriber E2E         | **Supported (GA)**                    |
| **Postmortems**            | `/postmortems`, `/[incidentId]`                    | Admin, Responder | Full C/R/U/D | Retrospective Lifecycle + Markdown        | **Supported (GA)**                    |
| **Dashboards & Pulse**     | `/`, `/reports/executive`, `/analytics`            | All Users        | Full C/R/U/D | Realtime SSE + Parity E2E                 | **Supported (GA - PR 915 in flight)** |
| **Enterprise Identity**    | `/login`, `/settings/system`, `/api/scim/v2`       | Admin, User      | Full C/R/U/D | RFC 7644 SCIM + SSO Suite                 | **Supported (GA)**                    |
| **High-Throughput Ingest** | `/api/events/high-throughput`                      | System           | N/A          | Feature branch                            | **Deferred (Post-2.1)**               |

---

## 2. Exhaustive Route-by-Route Matrix

### 2.1 Incident Command & Timeline Surfaces

| Path                          | Supported Role    | Operations                                               | Backend Dependencies                     | Automated Coverage                                              | Status        |
| ----------------------------- | ----------------- | -------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- | ------------- |
| `/incidents`                  | All Authenticated | Read (List, Filter, Search, Sort)                        | `prisma.incident`, Redis cache           | `tests/e2e/incidents.spec.ts`, REST v2                          | **Supported** |
| `/incidents/[id]`             | All Authenticated | Read, Update (Ack, Resolve, Escalate, Assign, Note, Tag) | PostgreSQL, Worker, WebSocket/SSE        | `tests/e2e/incidents.spec.ts`, `certify-ui-api-state-parity.ts` | **Supported** |
| `/incidents/create`           | Admin, Responder  | Create (Manual incident declaration)                     | `prisma.incident`, Notification worker   | Component unit + E2E modal flow                                 | **Supported** |
| `/incidents/templates`        | Admin             | Read, List templates                                     | `prisma.incidentTemplate`                | Unit component tests                                            | **Supported** |
| `/incidents/templates/create` | Admin             | Create template                                          | `prisma.incidentTemplate`                | Unit component tests                                            | **Supported** |
| `/postmortems/[incidentId]`   | All Authenticated | Read, Edit, Publish retrospective, Action Items          | `prisma.postmortem`, `prisma.actionItem` | `run-domain-workflows.ts (Workflow G)`                          | **Supported** |

### 2.2 Service Automation & Rule Engine

| Path                                  | Supported Role    | Operations                                      | Backend Dependencies                | Automated Coverage                               | Status        |
| ------------------------------------- | ----------------- | ----------------------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------- |
| `/services`                           | All Authenticated | List, Filter, Search services                   | `prisma.service`                    | `tests/e2e/services.spec.ts`                     | **Supported** |
| `/services/[id]`                      | All Authenticated | Service overview, health indicators, rules      | `prisma.service`, Automation Engine | UI verification + Responsive suite               | **Supported** |
| `/services/[id]/automations/[ruleId]` | Admin             | Rule authoring, conditions, transforms, dry-run | `prisma.serviceAutomationRule`      | `tests/components/automation-authoring.test.tsx` | **Supported** |
| `/services/[id]/integrations`         | Admin             | Webhooks, Slack, Teams, Jira bindings           | PostgreSQL, Encryption keyring      | Integration tests + E2E                          | **Supported** |
| `/services/[id]/notifications`        | Admin             | Notification routing, quiet hours, overrides    | PostgreSQL, Notification dispatch   | Notification channel suites                      | **Supported** |

### 2.3 On-Call Schedules & Escalation Policies

| Path              | Supported Role    | Operations                                   | Backend Dependencies             | Automated Coverage                       | Status        |
| ----------------- | ----------------- | -------------------------------------------- | -------------------------------- | ---------------------------------------- | ------------- |
| `/schedules`      | All Authenticated | List schedules, active on-call badges        | `prisma.onCallSchedule`          | `tests/e2e/schedules.spec.ts`            | **Supported** |
| `/schedules/[id]` | All Authenticated | Layer editing, calendar view, overrides, DST | PostgreSQL, Timezone engine      | `tests/integration/schedule-dst.test.ts` | **Supported** |
| `/policies`       | All Authenticated | List escalation policies, steps              | `prisma.escalationPolicy`        | Multi-replica E2E                        | **Supported** |
| `/policies/[id]`  | Admin, Team Lead  | Reorder rules, timeouts, repeat counts       | PostgreSQL, Escalation scheduler | `run-domain-workflows.ts (Workflow C)`   | **Supported** |

### 2.4 Runbook Engine & Agent Execution Plane

| Path                     | Supported Role    | Operations                                  | Backend Dependencies                      | Automated Coverage                         | Status        |
| ------------------------ | ----------------- | ------------------------------------------- | ----------------------------------------- | ------------------------------------------ | ------------- |
| `/runbooks`              | All Authenticated | List workflows, drafts, published revisions | `prisma.runbook`, `prisma.runbookVersion` | `tests/e2e/runbooks-ui.spec.ts`            | **Supported** |
| `/runbooks/[id]`         | Admin, Responder  | Visual editor, step definition, validation  | PostgreSQL, Agent dispatcher              | `tests/components/RunbookBuilder.test.tsx` | **Supported** |
| `/runbooks/executions`   | All Authenticated | Historical audit trail, logs, evidence      | PostgreSQL, Worker outbox                 | Native CI + Browser matrix                 | **Supported** |
| `/runbooks/agents`       | Admin             | Agent pool health, enrollment tokens        | `prisma.agent`, Mutual TLS/HMAC           | `runbook-validation.yml` CI                | **Supported** |
| `/runbooks/agents/pools` | Admin             | Dynamic targeting pools, health gating      | PostgreSQL                                | Isolation & policy unit suites             | **Supported** |

### 2.5 Status Platform (Public & Administrative)

| Path                              | Supported Role  | Operations                                       | Backend Dependencies           | Automated Coverage              | Status        |
| --------------------------------- | --------------- | ------------------------------------------------ | ------------------------------ | ------------------------------- | ------------- |
| `/status/[slug]`                  | Public (Unauth) | Incident timeline, uptime percentages, subscribe | PostgreSQL, RSS feed generator | Public isolation E2E + RSS test | **Supported** |
| `/settings/status-pages`          | Admin           | Custom branding, domain, privacy, services       | `prisma.statusPage`            | Multi-step workflow test        | **Supported** |
| `/status/[slug]/postmortems/[id]` | Public / Gated  | Published postmortem transparency views          | PostgreSQL                     | Retrospective integration suite | **Supported** |

### 2.6 Administration, Identity & System Health

| Path                 | Supported Role  | Operations                                            | Backend Dependencies           | Automated Coverage                          | Status        |
| -------------------- | --------------- | ----------------------------------------------------- | ------------------------------ | ------------------------------------------- | ------------- |
| `/login`             | Public          | Credentials sign-in, OAuth, session recovery          | NextAuth, Bcrypt, JWT          | Chrome DevTools CDP Live Tested (100% PASS) | **Supported** |
| `/login/emergency`   | Emergency Admin | Break-glass recovery token login                      | Sealed setup token             | `tests/e2e/auth-e2e.yml`                    | **Supported** |
| `/settings/system`   | Admin           | SCIM provisioning, SSO config, encryption info        | PostgreSQL, SCIM v2 engine     | `tests/e2e/scim-provisioning.spec.ts`       | **Supported** |
| `/settings/api-keys` | Admin, User     | API key creation, scope delegation, revocation        | HMAC-SHA256, API Key pool      | Multi-replica immediate revocation E2E      | **Supported** |
| `/audit`             | Auditor, Admin  | Cryptographically signed export stream, tamper checks | Real background worker, Outbox | `reconcile-all-workflows.ts`                | **Supported** |
