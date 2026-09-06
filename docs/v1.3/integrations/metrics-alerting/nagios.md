---
title: Nagios Core & XI Integration Guide
description: Configure Nagios Core and Nagios XI notification commands to send host and service alerts to OpsKnight.
version: v1.3
---

# Nagios Core & XI Integration Guide

OpsKnight natively integrates with **Nagios Core and Nagios XI** via notification commands.

---

## 🎯 Key Capabilities

- **Host & Service State Parsing**: Maps `CRITICAL`/`DOWN` $\to$ `critical`, `WARNING` $\to$ `warning`, `UNKNOWN`/`UNREACHABLE` $\to$ `error`, and `OK`/`UP` $\to$ `resolve`.
- **Downtime & Flapping Awareness**: Supports scheduled downtime (`DOWNTIMESTART`, `DOWNTIMEEND`) and flapping alerts (`FLAPPINGSTART`, `FLAPPINGEND`).
- **Flexible Payload Support**: Accepts JSON or form-encoded standard Nagios macro parameters.

---

## 🚀 Setup Instructions

### 1. In OpsKnight
1. Go to **Services** $\to$ select target service $\to$ **Integrations** tab.
2. Click **Add Integration** $\to$ choose **Nagios**.
3. Copy your **Webhook URL** and **Integration Key**.

---

### 2. Configure Nagios Commands (`commands.cfg`)

Add the following notification command definitions to your Nagios configuration:

```ini
# Host Notifications to OpsKnight
define command {
    command_name    notify-host-by-opsknight
    command_line    /usr/bin/curl -X POST -H "Content-Type: application/json" \
                    -d '{"notification_type":"$NOTIFICATIONTYPE$","host_name":"$HOSTNAME$","host_state":"$HOSTSTATE$","host_address":"$HOSTADDRESS$","output":"$HOSTOUTPUT$","long_output":"$LONGHOSTOUTPUT$","date_time":"$LONGDATETIME$"}' \
                    "https://your-opsknight.com/api/integrations/nagios?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY"
}

# Service Notifications to OpsKnight
define command {
    command_name    notify-service-by-opsknight
    command_line    /usr/bin/curl -X POST -H "Content-Type: application/json" \
                    -d '{"notification_type":"$NOTIFICATIONTYPE$","host_name":"$HOSTNAME$","host_address":"$HOSTADDRESS$","service_description":"$SERVICEDESC$","service_state":"$SERVICESTATE$","output":"$SERVICEOUTPUT$","long_output":"$LONGSERVICEOUTPUT$","date_time":"$LONGDATETIME$"}' \
                    "https://your-opsknight.com/api/integrations/nagios?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY"
}
```

### 3. Assign Commands to Contacts (`contacts.cfg`)

```ini
define contact {
    contact_name                    opsknight
    alias                           OpsKnight On-Call Alerting
    service_notification_period     24x7
    host_notification_period        24x7
    service_notification_options    w,u,c,r,f,s
    host_notification_options       d,u,r,f,s
    service_notification_commands   notify-service-by-opsknight
    host_notification_commands      notify-host-by-opsknight
}
```

Then reload or restart Nagios:
```bash
sudo systemctl reload nagios
```
