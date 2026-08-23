---
order: 1
title: AWS CloudWatch
description: Receive AWS CloudWatch alarms in OpsKnight via SNS
---

# AWS CloudWatch Integration

Receive CloudWatch alarms in OpsKnight via Amazon SNS.

---

## Endpoint

```
POST /api/integrations/cloudwatch?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Services** and select your service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Select **AWS CloudWatch**
5. Copy the **Integration ID**

### Step 2: Create SNS Topic

1. In AWS Console, go to **SNS** → **Topics**
2. Click **Create topic**
3. Choose **Standard** type
4. Name it (e.g., `opsknight-alerts`)
5. Click **Create topic**

### Step 3: Create HTTPS Subscription

1. Open your SNS topic
2. Click **Create subscription**
3. Configure:

| Field        | Value                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------ |
| **Protocol** | HTTPS                                                                                      |
| **Endpoint** | `https://YOUR_OPSKNIGHT_URL/api/integrations/cloudwatch?integrationId=YOUR_INTEGRATION_ID` |

4. Click **Create subscription**

### Step 4: Confirm Subscription

> **Important**: OpsKnight does NOT auto-confirm SNS subscriptions for security.

To confirm the subscription:

1. Check OpsKnight audit logs or server logs for the `SubscribeURL`
2. Visit the URL once to confirm
3. Or confirm manually in AWS Console if visible

### Step 5: Configure CloudWatch Alarms

1. Go to **CloudWatch** → **Alarms**
2. Create or edit an alarm
3. Under **Notification**, add the SNS topic you created
4. Save the alarm

---

## Payload Format

CloudWatch alarms are wrapped in SNS notifications:

### SNS Notification Wrapper

```json
{
  "Type": "Notification",
  "MessageId": "abc123",
  "TopicArn": "arn:aws:sns:us-east-1:123456789:opsknight-alerts",
  "Message": "{...CloudWatch alarm JSON...}",
  "Timestamp": "2024-01-15T10:00:00Z"
}
```

### CloudWatch Alarm Message

```json
{
  "AlarmName": "High CPU Usage",
  "AlarmDescription": "CPU usage exceeded 90% - CRITICAL",
  "NewStateValue": "ALARM",
  "NewStateReason": "Threshold crossed: CPU > 90%",
  "StateChangeTime": "2024-01-15T10:00:00Z",
  "Region": "us-east-1",
  "Trigger": {
    "MetricName": "CPUUtilization",
    "Namespace": "AWS/EC2",
    "Statistic": "Average",
    "Threshold": 90
  }
}
```

---

## Event Mapping

| CloudWatch State    | OpsKnight Action |
| ------------------- | ---------------- |
| `ALARM`             | Trigger incident |
| `OK`                | Resolve incident |
| `INSUFFICIENT_DATA` | No action        |

---

## Severity Mapping

Severity is determined by keywords in `AlarmDescription`:

| AlarmDescription Contains    | OpsKnight Severity |
| ---------------------------- | ------------------ |
| `CRITICAL`, `HIGH`           | critical           |
| `WARNING`, `ERROR`, `MEDIUM` | error              |
| `INFO`, `LOW`                | info               |
| (default for ALARM)          | critical           |

### Best Practice

Include severity keywords in your alarm descriptions:

```
High CPU Usage - CRITICAL - Production servers
Memory Usage Warning - WARNING - Development
```

---

## Incident Title

The incident title is set to the `AlarmName`.

The source is formatted as: `AWS CloudWatch ({Region})`

---

## Deduplication

Dedup key format: `cloudwatch-{Region}-{AlarmName}`

This ensures the same alarm in the same region maps to the same incident.

---

## Testing

### Using AWS Console

1. Go to **CloudWatch** → **Alarms**
2. Select an alarm
3. Click **Actions** → **Set alarm state**
4. Set to **ALARM**
5. Verify incident appears in OpsKnight
6. Set back to **OK** to test resolution

### Using AWS CLI

```bash
# Trigger alarm
aws cloudwatch set-alarm-state \
  --alarm-name "Your-Alarm-Name" \
  --state-value ALARM \
  --state-reason "Testing OpsKnight integration"

# Resolve alarm
aws cloudwatch set-alarm-state \
  --alarm-name "Your-Alarm-Name" \
  --state-value OK \
  --state-reason "Test complete"
```

---

## Troubleshooting

### Subscription Not Confirming

1. **Check logs** for the SubscribeURL
2. **Visit the URL** manually to confirm
3. **Verify endpoint** is accessible from AWS

### Alarms Not Appearing

1. **Check subscription status** in AWS SNS
2. **Verify alarm** has the SNS topic as notification target
3. **Test subscription** by publishing a test message

### Incidents Not Resolving

1. **Ensure alarm** sends OK notifications
2. **Check SNS delivery logs** for errors

### Wrong Severity

1. **Add severity keywords** to AlarmDescription
2. **Use uppercase**: CRITICAL, WARNING, INFO

---

## Related Topics

- [Azure Monitor Integration](./azure-monitor) — Azure monitoring
- [Google Cloud Monitoring Integration](./google-cloud-monitoring) — GCP monitoring
- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
