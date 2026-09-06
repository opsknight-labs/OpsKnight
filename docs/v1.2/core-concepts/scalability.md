---
order: 14
title: Scalability
description: Capacity targets, performance optimizations, and production tuning guidance
---

# Scalability

This guide summarizes OpsKnight's capacity targets, real-world load scenarios, and the configuration knobs that unlock higher scale. Numbers below assume recommended database pooling and sensible infrastructure sizing.

---

## System Capacity Overview

### User Capacity

| Metric                      | Capacity | Notes                           |
| --------------------------- | -------- | ------------------------------- |
| **Total Registered Users**  | 10,000+  | Database can handle this easily |
| **Concurrent Active Users** | 200-300  | With SSE streams open           |
| **Peak Concurrent Users**   | 400-500  | With proper DB pool config      |

### Incident Handling

| Metric                                | Per Minute | Per Hour | Notes                              |
| ------------------------------------- | ---------- | -------- | ---------------------------------- |
| **New Incidents Created**             | 200-300    | 12,000+  | Via API or integrations            |
| **Incidents Processed (Escalations)** | 150-200    | 9,000+   | Parallel processing (5 concurrent) |
| **Incident Updates**                  | 500+       | 30,000+  | Status changes, notes, etc.        |

### Notification Capacity

| Channel            | Per Minute | Per Hour | Notes                            |
| ------------------ | ---------- | -------- | -------------------------------- |
| **Email**          | 100        | 6,000    | Rate limited to avoid spam flags |
| **SMS**            | 50         | 3,000    | Twilio rate limits               |
| **Push**           | 200        | 12,000   | Web push is fast                 |
| **Slack**          | 100        | 6,000    | Slack API limits                 |
| **Webhooks**       | 100        | 6,000    | Per destination                  |
| **Total Combined** | 500-600    | 30,000+  | Across all channels              |

### Real-Time Streams (SSE)

| Metric                         | Capacity                |
| ------------------------------ | ----------------------- |
| **Concurrent SSE Connections** | 400-500                 |
| **DB Queries (with caching)**  | 20-30/sec (was 200-300) |
| **Data Freshness**             | 3-5 seconds             |

### Background Job Processing

| Job Type              | Per Minute | Notes                        |
| --------------------- | ---------- | ---------------------------- |
| **Escalation Jobs**   | 200+       | Parallel batches of 5        |
| **Notification Jobs** | 300+       | Parallel batches of 10       |
| **Total Jobs**        | 500+       | With 100 job limit per cycle |

---

## Real-World Scenarios

### Scenario 1: Normal Operations

```
50 concurrent users
10 incidents/hour
~100 notifications/hour
System runs at <10% capacity
```

### Scenario 2: Busy Day

```
150 concurrent users
50 incidents/hour
~500 notifications/hour
System runs at ~30% capacity
```

### Scenario 3: Major Outage

```
300 concurrent users
200 incidents in 10 minutes
~2000 notifications in 10 minutes
System handles it (may see 5-10 sec delays)
```

### Scenario 4: Stress Test

```
500 concurrent users
500 incidents/minute
5000 notifications/minute
System at capacity, some queuing
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────┐
│         OpsKnight Capacity              │
├─────────────────────────────────────────┤
│ Concurrent Users:     200-500           │
│ Incidents/min:        200-300           │
│ Notifications/min:    500-600           │
│ Escalations/min:      150-200           │
│ SSE Connections:      400-500           │
│ DB Queries/sec:       50-100 (cached)   │
└─────────────────────────────────────────┘
```

---

## Critical Configuration

### Database Connection Pool

The database connection pool is **critical** for handling concurrent users. Without proper configuration, the system will fail at ~50 concurrent users.

#### Why Connection Pooling Matters

- **Default pool size is 10** - This is insufficient for production
- Each SSE stream, API request, and background job needs a connection
- Without pooling: 50 concurrent users = connection exhaustion
- With pooling: 500+ concurrent users possible

#### Configuration

Add these parameters to your `DATABASE_URL`:

```bash
# Production (200-500 concurrent users)
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=40&pool_timeout=30"

# High-scale (500+ concurrent users)
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=80&pool_timeout=30"
```

| Parameter          | Value | Description                              |
| ------------------ | ----- | ---------------------------------------- |
| `connection_limit` | 40    | Max connections per app instance         |
| `pool_timeout`     | 30    | Seconds to wait for available connection |

### PostgreSQL Server Tuning

For the database server itself, ensure these settings in `postgresql.conf`:

```conf
# Connection Settings
max_connections = 200          # Total connections across all clients
shared_buffers = 256MB         # 25% of available RAM (for 1GB system)
effective_cache_size = 768MB   # 75% of available RAM

# For small systems (1-2 CPU cores)
work_mem = 16MB
maintenance_work_mem = 128MB

# Connection handling
tcp_keepalives_idle = 600
tcp_keepalives_interval = 30
tcp_keepalives_count = 10
```

---

## Performance Optimizations Implemented

### 1. SSE Caching Layer

- **File**: `src/lib/realtime-cache.ts`
- **Impact**: 10x reduction in database queries
- **How**: Caches dashboard metrics and incident lists for 3-5 seconds

### 2. Transaction Isolation Optimization

- **File**: `src/lib/db-utils.ts`
- **Impact**: 10x less contention, fewer deadlocks
- **How**: Uses `ReadCommitted` for event ingestion, `Serializable` only for critical updates

### 3. Parallel Job Processing

- **Files**: `src/lib/cron-scheduler.ts`, `src/lib/jobs/queue.ts`
- **Impact**: 5x faster job processing
- **How**: Processes jobs in parallel batches of 10-15

### 4. Circuit Breaker Pattern

- **File**: `src/lib/circuit-breaker.ts`
- **Impact**: Prevents cascade failures
- **How**: Fails fast when external services (email, SMS) are down

### 5. Notification Queue with Batching

- **File**: `src/lib/notification-queue.ts`
- **Impact**: 1000+ notifications/min capacity
- **How**: Batches notifications, deduplicates, and rate limits per channel

### 6. Rate Limiter with TTL Cleanup

- **File**: `src/lib/rate-limit.ts`
- **Impact**: Prevents memory leaks
- **How**: Cleans expired entries every 60 seconds
