---
order: 5
title: ManageEngine Integration Guide
description: Configure ManageEngine OpManager and Applications Manager Webhook Notification Profiles to trigger and auto-resolve OpsKnight incidents.
version: v1.5
---

# ManageEngine Integration Guide

OpsKnight provides native, first-class support for **ManageEngine OpManager**, **Applications Manager**, **Site24x7**, and **ServiceDesk Plus** through Webhook Notification Profiles.

---

## 🎯 Key Capabilities

- **Automatic Alarm & Clear Sync**: Threshold violations and availability alarms trigger incidents in OpsKnight; `Clear` events (`stringseverity: "Clear"` or `severity: 5`) automatically resolve the active incident using the ManageEngine `$entity` or `$alarmid`.
- **Full Severity & Urgency Taxonomy Mapping**:
  - `Critical` (1) / `Service Down` (4) / `Urgent` / `High` $\to$ **Critical** (`HIGH` urgency)
  - `Trouble` (2) / `Major` / `Error` $\to$ **Error** (`MEDIUM` urgency)
  - `Attention` (3) / `Minor` / `Warning` / `Medium` / `Moderate` $\to$ **Warning** (`MEDIUM` urgency)
  - `Clear` (5) / `Information` (6) / `Low` / `Normal` $\to$ **Info** (`LOW` urgency or auto-resolve)
- **Macro Sanitization**: Automatically strips unexpanded `$variable` macros (such as `$IntfField(ifName)` on non-interface alerts) so they never pollute incident metadata or deduplication keys.
- **Rich Context Ingestion**: Extracts device name, IP address, vendor, monitor category, event type, modification timestamp, operator acknowledgment notes, and direct alarm links.

---

## 🚀 Setup Instructions

### 1. Obtain Your OpsKnight Webhook URL

1. In OpsKnight, navigate to **Services** $\to$ select your target service $\to$ **Integrations** tab.
2. Click **Add Integration** and select **ManageEngine**.
3. Copy your unique **Webhook URL**:

```
https://your-opsknight-instance.com/api/integrations/manageengine?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

---

### 2. Configure a Webhook Notification Profile in ManageEngine OpManager

1. In the ManageEngine OpManager Web Console, navigate to **Settings** $\to$ **Notifications** $\to$ **Notification Profiles**.
2. Click **Add** to create a new profile and select **Invoke a Webhook**.
3. Configure the request settings:
   - **Hook URL**: Paste your OpsKnight Webhook URL.
   - **Method**: `POST`
   - **Data Type**: `Raw`
   - **Payload Type**: `JSON`
4. In **Body Content**, paste the following JSON template using OpManager dynamic variables:

```json
{
  "alarmid": "$alarmid",
  "entity": "$entity",
  "displayName": "$displayName",
  "ipAddress": "$DeviceField(ipAddress)",
  "vendor": "$DeviceField(vendor)",
  "stringseverity": "$stringseverity",
  "severity": "$severity",
  "category": "$category",
  "eventType": "$eventType",
  "ifName": "$IntfField(ifName)",
  "message": "$message",
  "strModTime": "$strModTime"
}
```

5. Click **Next**, select the **Trigger Criteria** (be sure to check **Critical**, **Trouble**, **Attention**, **Service Down**, and **Notify when the problem is cleared (Clear)** so OpsKnight can auto-resolve incidents), and save the profile.

---

## 🔍 Payload Specification

OpsKnight accepts both standard OpManager variable names and custom field naming conventions (`Alarm_ID`, `Alert_ID`, `Device_Name`, `Device_IP`, `Severity`, `Urgency`, `Message`):

```json
{
  "alarmid": "4092",
  "entity": "core-router-01_CPU_Utilization",
  "displayName": "core-router-01",
  "ipAddress": "10.20.1.1",
  "vendor": "Cisco",
  "stringseverity": "Critical",
  "severity": 1,
  "category": "Routers",
  "eventType": "Threshold Violation",
  "message": "CPU Utilization is 98% (Threshold: 90%)",
  "strModTime": "25 Sep 2026 11:45:00 IST"
}
```

---

## 🛠️ Troubleshooting

| Symptom                       | Cause                                 | Solution                                                                                                |
| :---------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------ |
| `HTTP 401 Unauthorized`       | Invalid or missing integration key    | Verify the `integrationKey` query parameter or `x-integration-key` header matches the key in OpsKnight. |
| Recovery not closing incident | Clear checkbox unchecked in OpManager | In the OpManager Notification Profile criteria, enable **Clear** notifications and include `"$entity"`. |
