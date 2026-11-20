# Product

<!-- impeccable:product-schema 1 -->

> Written from repository evidence (README, AGENTS.md, routes and roles in `src/app`). Facts that are
> inferred rather than confirmed by the maintainers are marked _(inferred)_.

## Platform

web: a Next.js console plus an installable mobile PWA (`/m`). There is no native app.

## Users

- **On-call responders** (SREs, platform and application engineers). They get paged at any hour, often
  on a phone, and need to know what is broken, how bad it is, who owns it and what to do next. They
  acknowledge, triage, escalate, add notes and resolve.
- **Incident commanders and team leads**. They run coordination during major incidents (ownership
  hand-offs, war rooms, status updates), manage rotations, overrides and escalation policies, and review
  workload.
- **Reliability and engineering managers**. They read MTTA/MTTR, SLA compliance and executive reports,
  drive postmortems and action items, and export or present dashboards (NOC/TV mode, print/PDF).
- **Administrators**. They self-host OpsKnight and configure users, teams, roles (RBAC), SSO/SCIM,
  integrations, notification providers, MCP access, retention and compliance.
- **Status page audiences** (customers, internal stakeholders). They read service health, incidents and
  maintenance on the public or private status page, and subscribe. They never sign in to the console.

## Product Purpose

OpsKnight is open-source (AGPL-3.0), self-hosted incident management and on-call. It covers the whole
loop on infrastructure the operator controls: detect, route, page, respond, communicate and learn. There
is no per-seat pricing, and incident data stays in the operator's own database. It succeeds when a page
reaches the right person, the responder understands the incident within seconds, and the organisation
learns from it afterwards.

## Positioning

A single self-hosted platform for alert ingestion, routing, multi-channel paging (Web Push, email, SMS,
WhatsApp, Twilio voice), the incident workspace, on-call schedules and escalation, ChatOps (Slack,
Microsoft Teams), status pages, analytics and postmortems, with durable delivery evidence and
authorization-bound actions throughout.

## Operating Context

### Jobs to be done

1. **When I'm paged**, I want to see the incident, its urgency, service and owner immediately and
   acknowledge it in one action, so the escalation stops and others know I'm on it.
2. **While responding**, I want the timeline, notes, related alerts, runbooks and SLA timers in one
   workspace, so I don't switch between tools under pressure.
3. **When I'm not the right person**, I want to reassign or escalate with clear ownership hand-off.
4. **Before my shift**, I want to see who is on call now and next and to create overrides safely
   (timezone- and DST-correct).
5. **During a major incident**, I want to keep customers informed through the status page and
   stakeholders through ChatOps without leaving the incident.
6. **After the incident**, I want to write a postmortem, track action items and see trends (MTTA, MTTR,
   SLA) to reduce repeat incidents.
7. **As an administrator**, I want to wire services, integrations, teams and permissions once and trust
   that RBAC, audit and retention hold.

### Surfaces and modes

| Surface                       | Routes                                                                                                                                               | Mode                     | Notes                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Operations console            | `/`, `/incidents`, `/services`, `/schedules`, `/policies`, `/teams`, `/users`, `/analytics`, `/reports`, `/postmortems`, `/runbooks`, `/settings/**` | **Operate**              | Desktop-first, dense, keyboard (`⌘K`), follows the user's Appearance preference (System / Light / Dark). |
| Mobile responder app (PWA)    | `/m/**`                                                                                                                                              | **Operate**              | Phone-first, 44px touch targets, per-device push, offline-safe actions, follows the system theme.        |
| Wallboard / NOC               | `/wallboard` (kiosk)                                                                                                                                 | **Operate** (glanceable) | Always dark, large numerals, readable from across a room.                                                |
| Public / private status page  | `/status/**`                                                                                                                                         | **Read**                 | Always light, customer-facing, minimal controls.                                                         |
| Documentation                 | opsknight.com/docs                                                                                                                                   | **Read**                 | Long-form measure (65–75ch), navigation over density.                                                    |
| Sign-in, setup, OAuth consent | `/login`, `/setup`, `/oauth/**`                                                                                                                      | Read / short task        | Always light, brand lockup (`AuthBrand`).                                                                |

### Environment

Responders are often interrupted, tired or on a phone at night, sometimes on poor networks. Desktop
users keep the console open all day on laptops (13–16") and large monitors, and often have many tabs
open _(inferred)_.

## Capabilities and Constraints

- Self-hosted, multi-runtime (web, scheduler, workers, status projector). There are no product CDN font
  or analytics calls: fonts are bundled with `next/font/local`.
- RBAC is enforced server-side for every action. The UI hides what a role cannot do but never relies on
  that for security.
- Timezone-correct everywhere (schedules, SLA, reports). Times are shown relative with absolute time and
  timezone on demand.
- Status pages and pre-sign-in pages are pinned light. The console and mobile follow the user preference.
- Terminology: _incident_ (triggered / acknowledged / snoozed / resolved), _urgency_ (high / medium / low),
  _service_, _escalation policy_, _schedule_ / _layer_ / _override_, _team_, _postmortem_, _action
  item_, _runbook_, _war room_.

## Brand Commitments

- Name **OpsKnight**. The background-less red shield-and-knight logo is never boxed in a dark square, and
  every brand mark links to https://opsknight.com/.
- Typefaces: Inter (UI/body) and Space Grotesk (titles, badges, brand marks).
- Tone: subtle, elegant, SRE-focused. No promotional clutter or gamification in operational surfaces or
  transactional alerts.
- Status colour semantics are fixed (critical crimson, elevated amber, ok emerald, info cobalt, on-call
  violet). See `AGENTS.md` §3 and `src/lib/design/status-palette.ts`.

## Evidence on Hand

- Product screenshots and tour: `public/readme/*.webp`, https://youtu.be/tE3Y1R4Hteg.
- Documentation: https://opsknight.com/docs/.
- No customer testimonials, logos or benchmarks are in the repository, so don't invent them.

## Product Principles

1. **Seconds matter.** The state, owner and next action of an incident must be readable at a glance.
2. **Familiar beats novel.** Standard patterns, one component vocabulary, no reinvented affordances.
3. **Trustworthy under pressure.** Every action shows its result (or a recoverable error), and nothing is
   silently lost.
4. **Operator-owned.** Self-hosted, private by default, no per-seat friction.
5. **Learn, don't blame.** Analytics and postmortems serve improvement, not surveillance.

## Accessibility & Inclusion

WCAG 2.2 AA in both themes: visible focus, labelled icon-only controls, keyboard operability, 44px touch
targets on mobile, colour never the only signal, `prefers-reduced-motion` and `prefers-contrast`
honoured, and Windows forced colours supported.
