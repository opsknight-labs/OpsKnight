# API Rate Limiting

OpsKnight implements rate limiting to protect the service from abuse and ensure fair resource allocation. This document describes the rate limiting implementation, default limits, and how to customize them.

## Overview

Rate limiting is implemented at the API layer using a distributed rate limiter backed by PostgreSQL. This allows rate limits to be enforced across multiple application instances without requiring additional infrastructure like Redis.

## Rate Limit Types

### 1. Per-Client Rate Limiting

Requests are rate-limited based on the client identifier:

- **Authenticated requests:** Rate limited by user ID
- **Unauthenticated requests:** Rate limited by IP address (via `X-Forwarded-For` or `X-Real-IP` headers)

### 2. Per-Endpoint Rate Limiting

Different endpoints have different rate limits based on their resource consumption and sensitivity:

| Endpoint Category                      | Limit        | Window   |
| -------------------------------------- | ------------ | -------- |
| Authentication (`/api/auth/*`)         | 10 requests  | 1 minute |
| Integrations (`/api/integrations/*`)   | 100 requests | 1 minute |
| General API (`/api/*`)                 | 60 requests  | 1 minute |
| Status Page API (`/api/status-page/*`) | 120 requests | 1 minute |
| Webhook endpoints                      | 200 requests | 1 minute |

## Response Headers

When rate limiting is active, the following headers are included in responses:

| Header                  | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `X-RateLimit-Limit`     | Maximum requests allowed in the window                      |
| `X-RateLimit-Remaining` | Remaining requests in the current window                    |
| `X-RateLimit-Reset`     | Unix timestamp when the rate limit resets                   |
| `Retry-After`           | Seconds until the rate limit resets (only on 429 responses) |

### Example Response Headers

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1706793600
```

### Rate Limit Exceeded Response

When the rate limit is exceeded, the API returns a `429 Too Many Requests` response:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 45
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1706793600

{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again in 45 seconds.",
  "retryAfter": 45
}
```

## Distributed Rate Limiting

OpsKnight uses a PostgreSQL-backed distributed rate limiter that works across multiple instances:

### How It Works

1. Each request increments a counter in the database
2. Counters are keyed by `{endpoint}:{clientId}:{windowStart}`
3. Old counters are periodically cleaned up
4. Uses optimistic locking to handle concurrent requests

### Benefits

- **No additional infrastructure:** Uses existing PostgreSQL database
- **Consistent across instances:** Works correctly with horizontal scaling
- **Persistent:** Rate limits survive application restarts
- **Accurate:** Uses database transactions for atomic operations

## Configuration

### Environment Variables

```bash
# Disable rate limiting (not recommended for production)
INTEGRATION_RATE_LIMIT=false

# Configure CORS allowed origins (affects rate limit identification)
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

### Customizing Rate Limits

Rate limits can be customized by modifying the rate limiter configuration in `src/lib/rate-limiter.ts`:

```typescript
// Example: Increase general API limit
const RATE_LIMITS = {
  default: {
    maxRequests: 120, // Increased from 60
    windowMs: 60000, // 1 minute
  },
  // ... other limits
};
```

### Per-Integration Rate Limits

Integration endpoints support custom rate limits per integration type:

```typescript
// Example: Higher limit for specific integration
const INTEGRATION_LIMITS = {
  datadog: { maxRequests: 200, windowMs: 60000 },
  prometheus: { maxRequests: 500, windowMs: 60000 },
  // ... other integrations use default
};
```

## Best Practices

### For API Consumers

1. **Implement exponential backoff:**

   ```javascript
   async function fetchWithRetry(url, options, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       const response = await fetch(url, options);
       if (response.status !== 429) return response;

       const retryAfter = response.headers.get('Retry-After') || 30;
       await new Promise(r => setTimeout(r, retryAfter * 1000));
     }
     throw new Error('Max retries exceeded');
   }
   ```

2. **Monitor rate limit headers:** Check `X-RateLimit-Remaining` before making requests

3. **Batch requests when possible:** Combine multiple operations into single API calls

4. **Use webhooks:** Instead of polling, subscribe to webhooks for real-time updates

### For Operators

1. **Monitor rate limit violations:** Set up alerts for high 429 response rates

2. **Adjust limits based on usage:** Review logs to find appropriate limits for your workload

3. **Consider API keys:** For high-volume integrations, use dedicated API keys with custom limits

## API Key Rate Limiting

API keys have their own rate limits that can be configured per key:

### Creating an API Key with Custom Limits

```http
POST /api/settings/api-keys
Content-Type: application/json

{
  "name": "Monitoring Integration",
  "rateLimit": {
    "maxRequests": 1000,
    "windowMs": 60000
  }
}
```

### API Key Rate Limit Headers

API key requests include additional headers:

```http
X-API-RateLimit-Limit: 1000
X-API-RateLimit-Remaining: 950
X-API-RateLimit-Reset: 1706793600
```

## Monitoring Rate Limits

### Logs

Rate limit events are logged with the following format:

```json
{
  "level": "warn",
  "message": "Rate limit exceeded",
  "component": "rate-limiter",
  "clientId": "ip:192.168.1.1",
  "endpoint": "/api/incidents",
  "limit": 60,
  "window": "60000ms"
}
```

### Metrics

Rate limiting metrics are available via the internal metrics endpoint:

- `opsknight_rate_limit_requests_total` - Total requests processed
- `opsknight_rate_limit_exceeded_total` - Total rate limit violations
- `opsknight_rate_limit_remaining` - Current remaining requests per client

## Bypassing Rate Limits

### Internal Requests

Internal requests (from the same host) bypass rate limiting:

```http
GET /api/status-page/domains
X-Internal-Request: status-domain-check
```

### Trusted Proxies

When running behind a load balancer, ensure proper header forwarding:

```nginx
# nginx configuration
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

## Troubleshooting

### "Rate limit exceeded" when limit shouldn't apply

1. **Check client identification:** Ensure `X-Forwarded-For` is properly set
2. **Verify timestamp sync:** Database and application servers should have synchronized clocks
3. **Check for shared IP:** Multiple users behind NAT share rate limits

### Rate limits not working across instances

1. **Verify database connectivity:** All instances must connect to the same database
2. **Check for connection pooling issues:** Ensure connections are properly released

### High database load from rate limiting

1. **Increase cleanup interval:** Reduce frequency of old counter cleanup
2. **Add database indexes:** Ensure proper indexing on rate limit table
3. **Consider caching:** Add in-memory cache for frequent rate limit checks
