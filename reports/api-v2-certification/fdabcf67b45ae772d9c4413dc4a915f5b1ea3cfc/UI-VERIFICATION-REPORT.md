# OpsKnight REST API v2 — Real Browser UI & Visual Evidence Certification

**Commit SHA**: `fdabcf67b45ae772d9c4413dc4a915f5b1ea3cfc`  
**Certified At**: `2026-10-25T07:12:35.740Z`  
**Target Environment**: `http://127.0.0.1:3900` (Docker Compose Release Stack)  
**Browser**: Google Chrome via Chrome DevTools Protocol (CDP)  

## 1. Responsive Viewport Certification

| Viewport | Dimensions | Layout Certified | Status |
|---|---|---|---|
| **Desktop** | 1280 x 800 | Full multi-column dashboard, sticky navigation, full tables | **PASS** |
| **Tablet** | 768 x 1024 | Responsive grid adaptation, collapsible navigation drawer | **PASS** |
| **Mobile** | 375 x 812 | Single-column stack, mobile touch menu, overflow protection | **PASS** |

## 2. Interactive UI Workflows Certified

- [x] **Modal Escape Key Dismissal**: `PASS`
- [x] **Client/Server Validation Negative Path**: `PASS`
- [x] **Mobile Viewport (375px) Certification**: `PASS`
- [x] **Tablet Viewport (768px) Certification**: `PASS`
- [x] **Desktop Viewport (1280px) Certification**: `PASS`
- [x] **CDP Chrome DevTools Protocol Verification**: `PASS`

## 3. Visual Evidence Gallery

All screenshots were captured from real running browser sessions against the release-candidate image:

| Screen / Flow | Viewport | Screenshot File | Description |
|---|---|---|---|
| **Login Screen** | `desktop` | [login_desktop.png](./EVIDENCE/login_desktop.png) | Authentication landing page with email/password fields |
| **Dashboard** | `desktop` | [dashboard_desktop.png](./EVIDENCE/dashboard_desktop.png) | Primary system dashboard overview |
| **Incidents List** | `desktop` | [incidents_list_desktop.png](./EVIDENCE/incidents_list_desktop.png) | Active incident list with urgency and severity indicators |
| **Incident Detail** | `desktop` | [incident_detail_desktop.png](./EVIDENCE/incident_detail_desktop.png) | Incident detail page showing timeline, alerts, and response controls |
| **Services List** | `desktop` | [services_list_desktop.png](./EVIDENCE/services_list_desktop.png) | Service directory with tier, health status, and ownership |
| **On-Call Schedules** | `desktop` | [schedules_desktop.png](./EVIDENCE/schedules_desktop.png) | Rotation schedules, layers, and active on-call coverage calendar |
| **Escalation Policies** | `desktop` | [escalation_policies_desktop.png](./EVIDENCE/escalation_policies_desktop.png) | Multi-tier escalation policy rules and notification targets |
| **Teams Directory** | `desktop` | [teams_desktop.png](./EVIDENCE/teams_desktop.png) | Operational teams, leads, and member rosters |
| **Runbooks Directory** | `desktop` | [runbooks_desktop.png](./EVIDENCE/runbooks_desktop.png) | Automated and manual remediation runbook catalog |
| **Status Pages** | `desktop` | [status_pages_desktop.png](./EVIDENCE/status_pages_desktop.png) | Public and private customer communication status platforms |
| **Incident Declaration Modal** | `desktop` | [modal_open_desktop.png](./EVIDENCE/modal_open_desktop.png) | Open declaration modal with form fields |
| **Modal Escape Dismissal** | `desktop` | [modal_dismissed_desktop.png](./EVIDENCE/modal_dismissed_desktop.png) | Modal dismissed cleanly on keyboard Escape key |
| **Form Validation Error** | `desktop` | [validation_error_desktop.png](./EVIDENCE/validation_error_desktop.png) | Required field validation highlights and error messages |
| **Login Screen** | `tablet` | [login_tablet.png](./EVIDENCE/login_tablet.png) | Authentication landing page with email/password fields |
| **Dashboard** | `tablet` | [dashboard_tablet.png](./EVIDENCE/dashboard_tablet.png) | Primary system dashboard overview |
| **Incidents List** | `tablet` | [incidents_list_tablet.png](./EVIDENCE/incidents_list_tablet.png) | Active incident list with urgency and severity indicators |
| **Incident Detail** | `tablet` | [incident_detail_tablet.png](./EVIDENCE/incident_detail_tablet.png) | Incident detail page showing timeline, alerts, and response controls |
| **Services List** | `tablet` | [services_list_tablet.png](./EVIDENCE/services_list_tablet.png) | Service directory with tier, health status, and ownership |
| **On-Call Schedules** | `tablet` | [schedules_tablet.png](./EVIDENCE/schedules_tablet.png) | Rotation schedules, layers, and active on-call coverage calendar |
| **Escalation Policies** | `tablet` | [escalation_policies_tablet.png](./EVIDENCE/escalation_policies_tablet.png) | Multi-tier escalation policy rules and notification targets |
| **Teams Directory** | `tablet` | [teams_tablet.png](./EVIDENCE/teams_tablet.png) | Operational teams, leads, and member rosters |
| **Runbooks Directory** | `tablet` | [runbooks_tablet.png](./EVIDENCE/runbooks_tablet.png) | Automated and manual remediation runbook catalog |
| **Status Pages** | `tablet` | [status_pages_tablet.png](./EVIDENCE/status_pages_tablet.png) | Public and private customer communication status platforms |
| **Login Screen** | `mobile` | [login_mobile.png](./EVIDENCE/login_mobile.png) | Authentication landing page with email/password fields |
| **Dashboard** | `mobile` | [dashboard_mobile.png](./EVIDENCE/dashboard_mobile.png) | Primary system dashboard overview |
| **Incidents List** | `mobile` | [incidents_list_mobile.png](./EVIDENCE/incidents_list_mobile.png) | Active incident list with urgency and severity indicators |
| **Incident Detail** | `mobile` | [incident_detail_mobile.png](./EVIDENCE/incident_detail_mobile.png) | Incident detail page showing timeline, alerts, and response controls |
| **Services List** | `mobile` | [services_list_mobile.png](./EVIDENCE/services_list_mobile.png) | Service directory with tier, health status, and ownership |
| **On-Call Schedules** | `mobile` | [schedules_mobile.png](./EVIDENCE/schedules_mobile.png) | Rotation schedules, layers, and active on-call coverage calendar |
| **Escalation Policies** | `mobile` | [escalation_policies_mobile.png](./EVIDENCE/escalation_policies_mobile.png) | Multi-tier escalation policy rules and notification targets |
| **Teams Directory** | `mobile` | [teams_mobile.png](./EVIDENCE/teams_mobile.png) | Operational teams, leads, and member rosters |
| **Runbooks Directory** | `mobile` | [runbooks_mobile.png](./EVIDENCE/runbooks_mobile.png) | Automated and manual remediation runbook catalog |
| **Status Pages** | `mobile` | [status_pages_mobile.png](./EVIDENCE/status_pages_mobile.png) | Public and private customer communication status platforms |
