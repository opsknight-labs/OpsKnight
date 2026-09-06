---
order: 8
title: Architecture
description: System design, high-availability architecture, deduplication, and circuit breakers.
---

# System Architecture

OpsKnight is engineered as a high-performance Next.js application with modular services, background queue workers, state-machine-driven circuit breakers, and sub-millisecond deduplication.

---

## High-Level Architectural Flow

```mermaid
flowchart LR
    %% Styles
    classDef client fill:#f9f9f9,stroke:#333,stroke-width:2px,rx:10;
    classDef service fill:#e3f2fd,stroke:#2196f3,stroke-width:2px,rx:5;
    classDef db fill:#fff3e0,stroke:#ff9800,stroke-width:2px,rx:5;
    classDef ext fill:#e8f5e9,stroke:#4caf50,stroke-width:2px,rx:5;

    subgraph Ingestion
        Monitor[Monitoring Sources]:::client
        Webhook[Webhook Ingress]:::service
        CB[Circuit Breaker]:::service
        Dedup[Dedup Engine]:::service
    end

    subgraph Core
        API[API / Next.js]:::service
        Worker[Queue Worker]:::service
    end

    subgraph Data
        PG[(PostgreSQL)]:::db
        Redis[(Redis Cache)]:::db
    end

    subgraph Dispatch
        Slack[Slack War Room]:::ext
        SMS[Twilio SMS]:::ext
        Email[Email / Push]:::ext
        Jira[Jira Sync]:::ext
    end

    Monitor --> Webhook --> CB --> Dedup --> API
    API --> PG & Redis
    API --> Worker
    Worker --> Slack & SMS & Email & Jira
```

---

## 📚 Deep Dive Architecture Specifications

| Architecture Topic | Key Components & Focus | Guide Link |
| :--- | :--- | :--- |
| **Circuit Breakers** | Cascading failure prevention, state machine transitions (`CLOSED`, `OPEN`, `HALF_OPEN`), and exponential backoff | [Circuit Breakers Specification](./architecture/circuit-breakers) |
| **Deduplication Engine** | SHA-256 event fingerprinting, sliding window correlation, and noise suppression | [Deduplication Engine Guide](./architecture/deduplication-engine) |
| **Enterprise Observability** | 24+ integration architecture, payload normalization pipelines, and dispatch routing | [Enterprise Observability](./architecture/enterprise-observability) |
| **Dashboard Architecture** | Real-time incident command center, keyboard hotkeys, and server component design | [Dashboard Architecture](./architecture/dashboard) |
| **System Settings** | Role-based access control (RBAC), API key hashing, and credential isolation | [Settings Architecture](./architecture/settings) |
| **System Flow Diagrams** | Sequence diagrams for incident lifecycle, escalation triggers, and postmortem loops | [Architecture Diagrams](./architecture/diagrams) |
