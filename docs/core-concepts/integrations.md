---
order: 8
---

# Integrations

Integrations connect OpsKnight to monitoring, alerting, and workflow tools. Events from integrations create or update incidents.

## How Integrations Work

1. External system sends a webhook
2. OpsKnight validates and normalizes the payload
3. Incidents are created or updated
4. Notifications are routed via escalation policies

## Supported Categories

- Monitoring and APM (Datadog, Prometheus, New Relic)
- Cloud (AWS, Azure, GCP)
- DevOps (GitHub, Bitbucket)
- Uptime (Pingdom, UptimeRobot)
- Generic Webhooks

See [Integrations](../integrations/) for setup guides.

## Create an Integration

1. Open a service
2. Go to **Integrations**
3. Click **Add Integration**
4. Copy the **Routing Key**

## Security

- Each integration uses a unique key
- Optional HMAC signature verification
- Rate limiting applied per integration

## Best Practices

- Use unique routing keys per service.
- Enable signature verification when available.
- Send resolve events when alerts clear.
