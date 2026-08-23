# Architecture Diagrams

This document provides visual representations of OpsKnight's architecture and key workflows.

## Table of Contents

- [High-Level System Architecture](#high-level-system-architecture)
- [Incident Lifecycle Flow](#incident-lifecycle-flow)
- [Notification Delivery Pipeline](#notification-delivery-pipeline)
- [Escalation Engine Flow](#escalation-engine-flow)
- [On-Call Schedule Resolution](#on-call-schedule-resolution)

---

## High-Level System Architecture

This diagram shows the main components of OpsKnight and how they interact.

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Web Browser]
        MOBILE[Mobile PWA]
        API_CLIENT[API Clients]
    end

    subgraph "Application Layer"
        NEXTJS[Next.js App]
        API[REST API]
        MIDDLEWARE[Middleware<br/>Auth, CORS, Security]
    end

    subgraph "Business Logic"
        INCIDENTS[Incident Management]
        SCHEDULES[On-Call Schedules]
        ESCALATION[Escalation Engine]
        NOTIFICATIONS[Notification System]
        STATUS[Status Page]
    end

    subgraph "Background Jobs"
        CRON[Cron Scheduler]
        QUEUE[Job Queue]
        RETRY[Notification Retry]
    end

    subgraph "Data Layer"
        PRISMA[Prisma ORM]
        POSTGRES[(PostgreSQL)]
    end

    subgraph "External Services"
        EMAIL[Email Providers<br/>Resend, SendGrid, SMTP, SES]
        SMS[SMS Providers<br/>Twilio, AWS SNS]
        PUSH[Web Push]
        SLACK[Slack Integration]
        INTEGRATIONS[Monitoring Integrations<br/>Datadog, PagerDuty, etc.]
    end

    WEB --> NEXTJS
    MOBILE --> NEXTJS
    API_CLIENT --> API
    INTEGRATIONS --> API

    NEXTJS --> MIDDLEWARE
    API --> MIDDLEWARE
    MIDDLEWARE --> INCIDENTS
    MIDDLEWARE --> SCHEDULES
    MIDDLEWARE --> STATUS

    INCIDENTS --> ESCALATION
    ESCALATION --> NOTIFICATIONS
    SCHEDULES --> ESCALATION

    CRON --> ESCALATION
    CRON --> QUEUE
    QUEUE --> NOTIFICATIONS
    RETRY --> NOTIFICATIONS

    NOTIFICATIONS --> EMAIL
    NOTIFICATIONS --> SMS
    NOTIFICATIONS --> PUSH
    NOTIFICATIONS --> SLACK

    INCIDENTS --> PRISMA
    SCHEDULES --> PRISMA
    ESCALATION --> PRISMA
    STATUS --> PRISMA
    PRISMA --> POSTGRES
```

---

## Incident Lifecycle Flow

This diagram shows how an incident progresses through its lifecycle.

```mermaid
stateDiagram-v2
    [*] --> OPEN: Incident Created

    OPEN --> ACKNOWLEDGED: User Acknowledges
    OPEN --> SNOOZED: User Snoozes
    OPEN --> RESOLVED: Auto-Resolved
    OPEN --> ESCALATED: Escalation Triggered

    ACKNOWLEDGED --> RESOLVED: User Resolves
    ACKNOWLEDGED --> SNOOZED: User Snoozes

    SNOOZED --> OPEN: Snooze Expires
    SNOOZED --> RESOLVED: User Resolves

    ESCALATED --> ACKNOWLEDGED: User Acknowledges
    ESCALATED --> RESOLVED: User Resolves

    RESOLVED --> [*]

    note right of OPEN
        - Triggers escalation policy
        - Sends initial notifications
        - SLA timers start
    end note

    note right of ACKNOWLEDGED
        - Stops escalation
        - SLA acknowledge timer stops
        - Resolution timer continues
    end note

    note right of SNOOZED
        - Escalation paused
        - Auto-reopens when snooze expires
        - Can set custom snooze duration
    end note

    note right of RESOLVED
        - All escalations stopped
        - SLA metrics recorded
        - Postmortem can be created
    end note
```

### Incident Events Timeline

```mermaid
sequenceDiagram
    participant I as Integration
    participant API as OpsKnight API
    participant INC as Incident
    participant ESC as Escalation Engine
    participant NOT as Notifications
    participant USER as On-Call User

    I->>API: POST /api/integrations/{type}
    API->>INC: Create Incident
    INC->>ESC: Trigger Escalation Policy

    loop Each Escalation Step
        ESC->>ESC: Wait for delay (if any)
        ESC->>NOT: Send Notifications
        NOT->>USER: Email, SMS, Push, Slack

        alt User Acknowledges
            USER->>API: Acknowledge Incident
            API->>ESC: Stop Escalation
        else Timeout
            ESC->>ESC: Proceed to next step
        end
    end

    USER->>API: Resolve Incident
    API->>INC: Mark Resolved
    INC->>NOT: Send Resolution Notification
```

---

## Notification Delivery Pipeline

This diagram shows how notifications are processed and delivered.

```mermaid
flowchart TD
    subgraph "Notification Trigger"
        INCIDENT[Incident Event]
        ESCALATION[Escalation Step]
        STATUS_UPDATE[Status Page Update]
        SUBSCRIPTION[Subscription Alert]
    end

    subgraph "User Resolution"
        RESOLVE_TARGET[Resolve Target]
        RESOLVE_PREFS[Get User Preferences]
        CHANNEL_SELECT[Select Channels]
    end

    subgraph "Channel Processing"
        EMAIL_QUEUE[Email Queue]
        SMS_QUEUE[SMS Queue]
        PUSH_QUEUE[Push Queue]
        SLACK_QUEUE[Slack Queue]
    end

    subgraph "Delivery"
        EMAIL_SEND[Send Email]
        SMS_SEND[Send SMS]
        PUSH_SEND[Send Push]
        SLACK_SEND[Send Slack]
    end

    subgraph "Tracking"
        LOG_DELIVERY[Log Delivery]
        RETRY_FAILED[Retry Failed]
        AUDIT[Audit Log]
    end

    INCIDENT --> RESOLVE_TARGET
    ESCALATION --> RESOLVE_TARGET
    STATUS_UPDATE --> RESOLVE_TARGET
    SUBSCRIPTION --> RESOLVE_TARGET

    RESOLVE_TARGET --> RESOLVE_PREFS
    RESOLVE_PREFS --> CHANNEL_SELECT

    CHANNEL_SELECT -->|Email enabled| EMAIL_QUEUE
    CHANNEL_SELECT -->|SMS enabled| SMS_QUEUE
    CHANNEL_SELECT -->|Push enabled| PUSH_QUEUE
    CHANNEL_SELECT -->|Slack enabled| SLACK_QUEUE

    EMAIL_QUEUE --> EMAIL_SEND
    SMS_QUEUE --> SMS_SEND
    PUSH_QUEUE --> PUSH_SEND
    SLACK_QUEUE --> SLACK_SEND

    EMAIL_SEND --> LOG_DELIVERY
    SMS_SEND --> LOG_DELIVERY
    PUSH_SEND --> LOG_DELIVERY
    SLACK_SEND --> LOG_DELIVERY

    LOG_DELIVERY -->|Failed| RETRY_FAILED
    RETRY_FAILED --> EMAIL_QUEUE
    RETRY_FAILED --> SMS_QUEUE

    LOG_DELIVERY --> AUDIT
```

### Notification Priority

```mermaid
graph LR
    subgraph "Notification Channels"
        direction TB
        HIGH[HIGH Urgency]
        MEDIUM[MEDIUM Urgency]
        LOW[LOW Urgency]
    end

    HIGH -->|All channels| ALL[SMS + Email + Push + Slack]
    MEDIUM -->|Primary channels| PRIMARY[Email + Push + Slack]
    LOW -->|Quiet channels| QUIET[Email + Slack]
```

---

## Escalation Engine Flow

This diagram shows how the escalation engine processes escalation policies.

```mermaid
flowchart TD
    START([Incident Created]) --> CHECK_POLICY{Has Escalation<br/>Policy?}

    CHECK_POLICY -->|No| END_NO_POLICY([No Escalation])
    CHECK_POLICY -->|Yes| GET_STEP[Get Current Step]

    GET_STEP --> CHECK_DELAY{Step has<br/>delay?}

    CHECK_DELAY -->|Yes| SCHEDULE[Schedule Job<br/>for Future]
    SCHEDULE --> WAIT([Wait for Delay])
    WAIT --> EXECUTE

    CHECK_DELAY -->|No| EXECUTE[Execute Step]

    EXECUTE --> RESOLVE_TARGET[Resolve Target<br/>User/Team/Schedule]

    RESOLVE_TARGET --> ACQUIRE_LOCK{Acquire<br/>Lock?}

    ACQUIRE_LOCK -->|No| SKIP([Skip - Another<br/>Worker Processing])
    ACQUIRE_LOCK -->|Yes| SEND_NOTIFICATIONS[Send Notifications]

    SEND_NOTIFICATIONS --> CHECK_ACK{Incident<br/>Acknowledged?}

    CHECK_ACK -->|Yes| STOP([Stop Escalation])
    CHECK_ACK -->|No| NEXT_STEP{More<br/>Steps?}

    NEXT_STEP -->|Yes| GET_STEP
    NEXT_STEP -->|No| COMPLETE([Escalation Complete])

    STOP --> RELEASE_LOCK[Release Lock]
    COMPLETE --> RELEASE_LOCK
```

### Escalation Target Resolution

```mermaid
flowchart TD
    TARGET[Escalation Target] --> TYPE{Target Type?}

    TYPE -->|USER| RETURN_USER[Return User ID]

    TYPE -->|TEAM| CHECK_LEAD{Notify Only<br/>Team Lead?}
    CHECK_LEAD -->|Yes| RETURN_LEAD[Return Team Lead]
    CHECK_LEAD -->|No| RETURN_MEMBERS[Return All Members]

    TYPE -->|SCHEDULE| CHECK_OVERRIDE{Active<br/>Override?}
    CHECK_OVERRIDE -->|Yes| RETURN_OVERRIDE[Return Override User]
    CHECK_OVERRIDE -->|No| CALCULATE[Calculate On-Call<br/>from Layers]
    CALCULATE --> RETURN_ONCALL[Return On-Call Users]

    RETURN_USER --> RESULT([User IDs])
    RETURN_LEAD --> RESULT
    RETURN_MEMBERS --> RESULT
    RETURN_OVERRIDE --> RESULT
    RETURN_ONCALL --> RESULT
```

---

## On-Call Schedule Resolution

This diagram shows how on-call schedules are resolved to determine who is currently on-call.

```mermaid
flowchart TD
    START([Get On-Call Users]) --> TIME[Get Current Time]
    TIME --> TZ[Convert to Schedule Timezone]

    TZ --> CHECK_OVERRIDE{Active<br/>Override?}

    CHECK_OVERRIDE -->|Yes| OVERRIDE_USERS[Return Override Users]

    CHECK_OVERRIDE -->|No| GET_LAYERS[Get All Layers]

    GET_LAYERS --> LOOP[For Each Layer]

    LOOP --> CHECK_RESTRICTION{Within<br/>Restrictions?}

    CHECK_RESTRICTION -->|No| SKIP_LAYER[Skip Layer]
    SKIP_LAYER --> LOOP

    CHECK_RESTRICTION -->|Yes| CALC_ROTATION[Calculate Rotation Position]

    CALC_ROTATION --> GET_USER[Get User at Position]
    GET_USER --> ADD_BLOCK[Add to Schedule Blocks]
    ADD_BLOCK --> LOOP

    LOOP -->|All layers processed| PRIORITY[Apply Layer Priority]

    PRIORITY --> FINAL[Get Final On-Call Users]
    FINAL --> RESULT([Return User IDs])
    OVERRIDE_USERS --> RESULT
```

### Schedule Layer Example

```mermaid
gantt
    title On-Call Schedule (24 hours)
    dateFormat HH:mm
    axisFormat %H:%M

    section Layer 1 (Primary)
    User A :a1, 00:00, 8h
    User B :a2, 08:00, 8h
    User A :a3, 16:00, 8h

    section Layer 2 (Backup)
    User C :b1, 00:00, 12h
    User D :b2, 12:00, 12h

    section Override
    User E (Override) :crit, o1, 14:00, 4h
```

---

## Database Schema Overview

Key entity relationships:

```mermaid
erDiagram
    User ||--o{ TeamMember : "belongs to"
    Team ||--o{ TeamMember : "has"
    Team ||--o{ Service : "owns"
    Service ||--o{ Incident : "has"
    Service ||--|| EscalationPolicy : "uses"
    EscalationPolicy ||--o{ EscalationStep : "has"
    Incident ||--o{ IncidentEvent : "has"
    Incident ||--o| Postmortem : "may have"
    OnCallSchedule ||--o{ ScheduleLayer : "has"
    OnCallSchedule ||--o{ ScheduleOverride : "has"
    ScheduleLayer ||--o{ LayerUser : "has"
    User ||--o{ LayerUser : "assigned to"
    StatusPage ||--o{ StatusPageService : "shows"
    StatusPage ||--o{ Announcement : "has"
```

---

## Component Interaction Summary

| Component           | Interacts With            | Purpose               |
| ------------------- | ------------------------- | --------------------- |
| Next.js App         | All components            | Request handling, SSR |
| Prisma ORM          | PostgreSQL                | Data access           |
| Cron Scheduler      | Escalation, Jobs, Rollups | Background processing |
| Escalation Engine   | Schedules, Notifications  | Incident routing      |
| Notification System | Email, SMS, Push, Slack   | Message delivery      |
| Status Page         | Services, Incidents       | Public visibility     |
| Integrations        | External monitoring tools | Alert ingestion       |
