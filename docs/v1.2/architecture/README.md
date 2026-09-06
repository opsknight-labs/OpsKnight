---
order: 8
title: Internals
description: How this version is put together — for operators who already run the product.
---

# System Architecture

OpsKnight is designed as a **monolithic Next.js application** for simplicity and performance, backed by robust infrastructure for reliability.

## High-Level Overview

The system runs as a single service (`opsknight-app`) handling both the frontend (React server components) and the backend (API routes, job processing).

### Components

```mermaid
flowchart LR
    %% Styles
    classDef client fill:#f9f9f9,stroke:#333,stroke-width:2px,rx:10;
    classDef service fill:#e3f2fd,stroke:#2196f3,stroke-width:2px,rx:5;
    classDef db fill:#fff3e0,stroke:#ff9800,stroke-width:2px,rx:5;
    classDef ext fill:#e8f5e9,stroke:#4caf50,stroke-width:2px,rx:5;

    subgraph Clients
        User((User)):::client
        Monitor[Monitor]:::client
    end

    subgraph Core
        LB[Ingress]:::service
        NextJS[Next.js App]:::service
        API[API]:::service
        Worker[Worker]:::service
    end

    subgraph Data
        PG[(DB)]:::db
        Redis[(Cache)]:::db
    end

    subgraph Channels
        Slack[Slack]:::ext
        SMS[Twilio SMS]:::ext
        WA[WhatsApp]:::ext
        Email[Email]:::ext
        Push[Push]:::ext
    end

    %% Flows
    User --> LB --> NextJS --> API
    Monitor -->|Webhook| LB
    API --> PG & Redis
    API -->|Job| Worker
    Worker -->|Poll| PG
    Worker -->|Dispatch| Slack & SMS & WA & Email & Push
```

---

## 🏗️ Core Layers

### 1. Application Layer (Next.js)

- **Frontend**: Built with React 19 and Tailwind CSS. Fully server-rendered where possible (RSC) for speed.
- **API**: Next.js API Routes serve as the backend interface for the frontend and external webhooks (Prometheus, Datadog).
- **Worker**: A background polling mechanism (or job queue consumer) running within the node process to handle async tasks like customized escalation timeouts.

### 2. Data Persistence

- **PostgreSQL**: The source of truth for all data (Incidents, Users, Schedules).
- **Prisma**: Type-safe ORM used for all database access.
- **Redis (Optional)**: Used for caching status pages and session storage in high-scale deployments.

### 3. Notification Engine

The engine handles the logic of "Who to notify next?".

1.  **Trigger**: Incident created via Webhook.
2.  **Determine Policy**: Lookout up the Service's Escalation Policy.
3.  **Find On-Call**: Calculate who is currently on-call for that policy step.
4.  **Dispatch**: Send the alert via the user's preferred channel (Slack, SMS, etc.).

## 🔄 Data Flow

1.  **Inbound**: `POST /api/webhooks/prometheus` receives an alert payload.
2.  **Processing**: The API verifies the signature, creates an `Incident` record in Postgres, and enqueues a `ProcessIncident` job.
3.  **Outbound**: The worker picks up the job, resolves the `EscalationPolicy`, and dispatches a notification to the `Channels`.

## 🛡️ Security

- **Authentication**: Usage of NextAuth.js (Auth.js) for secure session management.
- **RBAC**: Role-Based Access Control logic ensures only authorized users can acknowledge or resolve incidents.
- **API Keys**: Service-level API tokens are hashed and validated for ingestion.
