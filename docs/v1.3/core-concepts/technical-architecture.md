---
order: 5
title: Technical Architecture
description: Comprehensive System Architecture, Data Flow, and Component Design.
---

# Technical Architecture

OpsKnight is designed as a **cloud-native, event-driven platform** built on the Next.js App Router. It separates the **Control Plane** (User Interaction & API) from the **Worker Plane** (Reliability & Async Processing) to ensure high availability and zero-data-loss for critical alerts.

## High-Level System Architecture

The following diagram details the **System Logic Flow**, mapping exactly how data moves through the ingestion pipeline, the database, and the asynchronous reliability engine.

![OpsKnight Data Flow Architecture](/assets/images/opsknight-system-flow.png)

## Core Subsystems

### 1. Ingestion Pipeline (The "Funnel")

The entry point for all chaos.

- **Normalization**: The `API` layer accepts generic webhooks or provider-specific payloads (Datadog, Prometheus). It normalizes them into a standard `GenericEvent` schema.
- **Deduplication**: Before persisting, the engine checks for existing open incidents with the same `dedup_key` to prevent alert storms.
- **Enrichment**: Metadata is added (Service ownership, tagging) before the incident is written to Postgres.

### 2. Background Processing (Cron)

We use **node-cron** for reliable background task scheduling within the main application instance.

- **Mechanism**: A scheduled task runner initializes on server startup (`server.ts`).
- **Core Responsibilities**:
  - **Escalation Processing**: Polls every minute for incidents requiring escalation steps.
  - **SLA Monitoring**: Checks for SLA breaches and updates status snapshots.
  - **Data Retention**: Specific jobs (like `data-cleanup.ts`) handle pruning of old logs and metrics.
- **Reliability**:
  - **Atomic Operations**: Uses Prisma transactions to ensure data consistency during processing.
  - **Idempotency**: Jobs are designed to be safe to run multiple times (skip if already processed).

### 3. The PWA (Client)

The frontend is a **Progressive Web App** built with Next.js App Router.

- **Optimistic UI**: Use of `useOptimistic` hooks ensures the UI feels instant (e.g., when clicking "Acknowledge"), while the server processes the request in the background.
- **Service Workers**: Handles `web-push` events to wake up the potential responder even if the browser tab is closed.
- **Data Fetching**: Hybrid approach using Server Components for initial load and efficient client-side polling/revalidation for live updates.

### 4. Security & Compliance

- **Authentication**: Managed via `NextAuth.js`, supporting generic OIDC and Email Magic Links.
- **RBAC**: Role-Based Access Control checks are enforced at the API Handler level.
- **Audit Trails**: Every state change is written to an immutable `IncidentEvent` ledger.

## Data Schema (Simplified)

![OpsKnight Database Schema](/assets/images/opsknight-er-diagram.png)
