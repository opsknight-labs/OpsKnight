---
title: Icinga 2 Integration Guide
description: Configure Icinga 2 notification objects and commands to forward alerts to OpsKnight.
version: v1.3
---

# Icinga 2 Integration Guide

OpsKnight natively integrates with **Icinga 2** monitoring daemons.

---

## 🚀 Setup Instructions

### 1. In OpsKnight
1. Go to **Services** $\to$ select target service $\to$ **Integrations** tab.
2. Click **Add Integration** $\to$ choose **Icinga**.
3. Copy your **Webhook URL** and **Integration Key**.

---

### 2. Configure Icinga 2 Notification Command (`/etc/icinga2/conf.d/opsknight-command.conf`)

```icinga2
object NotificationCommand "opsknight-service-notification" {
  command = [
    "/usr/bin/curl",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", "$opsknight_payload$",
    "$opsknight_url$"
  ]

  vars.opsknight_url = "https://your-opsknight.com/api/integrations/icinga?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY"

  vars.opsknight_payload = {{
    var payload = {
      notification_type = macro("$notification.type$"),
      host_name = macro("$host.name$"),
      host_state = macro("$host.state$"),
      host_address = macro("$host.address$"),
      service_name = macro("$service.name$"),
      service_state = macro("$service.state$"),
      service_output = macro("$service.output$"),
      author = macro("$notification.author$"),
      comment = macro("$notification.comment$")
    }
    return Json.encode(payload)
  }}
}
```

### 3. Apply Notification Object

```icinga2
apply Notification "opsknight-alerts" to Service {
  command = "opsknight-service-notification"
  states = [ OK, Warning, Critical, Unknown ]
  types = [ Problem, Acknowledgement, Recovery, Custom ]
  period = "24x7"
  users = [ "opsknight-user" ]
  assign where service.enable_notifications == true
}
```

Restart Icinga 2:
```bash
sudo systemctl restart icinga2
```
