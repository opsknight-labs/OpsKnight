---
order: 3
title: Custom Fields
description: Add custom metadata to incidents for better organization, filtering, and reporting
---

# Custom Fields

Custom fields allow you to capture additional context on incidents beyond the standard fields. Use them for environment tags, customer information, affected components, or any metadata relevant to your organization.

---

## Overview

Custom fields are organization-wide and appear on all incidents. Each field has:

- **Name**: Display label shown in the UI
- **Key**: Unique identifier used in API calls and filters
- **Type**: Data type (text, number, select, etc.)
- **Required**: Whether the field must be filled
- **Show in List**: Whether to display in incident tables

---

## Field Types

| Type      | Description                              | Example Use                          |
| --------- | ---------------------------------------- | ------------------------------------ |
| `TEXT`    | Free-form text input                     | Ticket ID, Customer name             |
| `NUMBER`  | Numeric value                            | Impact score, User count             |
| `DATE`    | Date picker                              | Deadline, SLA date                   |
| `SELECT`  | Single selection from predefined options | Environment, Priority tier           |
| `BOOLEAN` | True/false toggle                        | Customer-facing, Requires postmortem |
| `URL`     | Validated URL input                      | Ticket link, Dashboard URL           |
| `EMAIL`   | Validated email input                    | Reporter email                       |

---

## Creating Custom Fields

**Requirements**: Admin role

### Via UI

1. Go to **Settings** → **Custom Fields**
2. Click **Add Field**
3. Configure field properties:

| Setting           | Description                 | Constraints                                        |
| ----------------- | --------------------------- | -------------------------------------------------- |
| **Name**          | Display label               | 1-200 characters                                   |
| **Key**           | Unique identifier           | 1-100 characters, alphanumeric and underscore only |
| **Type**          | Field data type             | TEXT, NUMBER, DATE, SELECT, BOOLEAN, URL, EMAIL    |
| **Required**      | Must be filled on incidents | Default: false                                     |
| **Default Value** | Pre-filled value            | Optional                                           |
| **Show in List**  | Display in incident tables  | Default: false                                     |
| **Options**       | Choices for SELECT type     | JSON array                                         |

4. Click **Save**

### Key Format

Keys must follow this pattern:

- Only letters, numbers, and underscores
- No spaces or special characters
- Case-sensitive

**Valid keys**: `environment`, `customer_tier`, `region_code`

**Invalid keys**: `my-field`, `customer tier`, `priority!`

---

## Field Type Details

### TEXT

Free-form text input for any string value.

```json
{
  "name": "Ticket ID",
  "key": "ticket_id",
  "type": "TEXT",
  "required": false
}
```

### NUMBER

Numeric input that accepts integers and decimals.

```json
{
  "name": "Affected Users",
  "key": "affected_users",
  "type": "NUMBER",
  "required": false,
  "defaultValue": "0"
}
```

### DATE

Date picker for selecting a date.

```json
{
  "name": "Target Resolution",
  "key": "target_resolution",
  "type": "DATE",
  "required": false
}
```

### SELECT

Dropdown with predefined options. Options are stored as a JSON array.

```json
{
  "name": "Environment",
  "key": "environment",
  "type": "SELECT",
  "required": true,
  "defaultValue": "production",
  "options": ["production", "staging", "development"]
}
```

### BOOLEAN

True/false toggle.

```json
{
  "name": "Customer Facing",
  "key": "customer_facing",
  "type": "BOOLEAN",
  "required": false,
  "defaultValue": "true"
}
```

### URL

Validated URL input. Must start with http:// or https://.

```json
{
  "name": "Dashboard Link",
  "key": "dashboard_link",
  "type": "URL",
  "required": false
}
```

### EMAIL

Validated email address input.

```json
{
  "name": "Reporter Email",
  "key": "reporter_email",
  "type": "EMAIL",
  "required": false
}
```

---

## Using Custom Fields

### On Incidents

When creating or editing an incident:

1. Custom fields appear in the incident form
2. Required fields must be filled before saving
3. Default values are pre-populated

### Filtering Incidents

Filter incidents by custom field values:

1. Go to **Incidents**
2. Click **Filters**
3. Select a custom field
4. Choose or enter filter value

### In Exports

Custom field values are included in incident exports (CSV, JSON).

### On Status Page

Configure which custom fields appear on the public status page:

1. Go to **Settings** → **Status Page**
2. Enable **Show Custom Fields**
3. Select which fields to display via **Allowed Custom Fields**

---

## API Usage

### Getting Custom Fields

```bash
GET /api/settings/custom-fields
Authorization: Bearer YOUR_API_KEY
```

**Response**:

```json
{
  "fields": [
    {
      "id": "cf_abc123",
      "name": "Environment",
      "key": "environment",
      "type": "SELECT",
      "required": true,
      "defaultValue": "production",
      "options": ["production", "staging", "development"],
      "order": 1,
      "showInList": true
    }
  ]
}
```

### Creating Custom Fields

```bash
POST /api/settings/custom-fields
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "name": "Customer Tier",
  "key": "customer_tier",
  "type": "SELECT",
  "required": false,
  "options": ["enterprise", "business", "free"],
  "showInList": true
}
```

**Requires**: Admin role

### Setting Values on Incidents

Custom field values are set via the custom fields endpoint:

```bash
POST /api/incidents/{id}/custom-fields
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "customFieldId": "cf_abc123",
  "value": "production"
}
```

---

## Example Configurations

### Environment Field

| Setting      | Value                            |
| ------------ | -------------------------------- |
| Name         | Environment                      |
| Key          | `environment`                    |
| Type         | SELECT                           |
| Options      | production, staging, development |
| Required     | Yes                              |
| Default      | production                       |
| Show in List | Yes                              |

### Customer Tier Field

| Setting      | Value                      |
| ------------ | -------------------------- |
| Name         | Customer Tier              |
| Key          | `customer_tier`            |
| Type         | SELECT                     |
| Options      | enterprise, business, free |
| Required     | No                         |
| Show in List | Yes                        |

### Affected Users Count

| Setting      | Value            |
| ------------ | ---------------- |
| Name         | Affected Users   |
| Key          | `affected_users` |
| Type         | NUMBER           |
| Required     | No               |
| Default      | 0                |
| Show in List | Yes              |

### External Ticket Link

| Setting      | Value         |
| ------------ | ------------- |
| Name         | Jira Ticket   |
| Key          | `jira_ticket` |
| Type         | URL           |
| Required     | No            |
| Show in List | No            |

---

## Field Ordering

Fields appear in the order defined by their `order` value:

- New fields are automatically assigned the next order number
- Lower order values appear first

---

## Best Practices

### Field Design

- **Keep keys consistent** — Use snake_case for readability
- **Use SELECT for controlled values** — Prevents typos, enables filtering
- **Mark truly required fields** — Too many required fields slow down incident creation
- **Enable Show in List sparingly** — Too many columns clutters the table

### Naming Conventions

| Good                 | Bad                  |
| -------------------- | -------------------- |
| `customer_tier`      | `tier` (too vague)   |
| `affected_region`    | `region` (ambiguous) |
| `external_ticket_id` | `ticket` (unclear)   |

### When to Use Custom Fields

| Scenario                    | Recommendation   |
| --------------------------- | ---------------- |
| Categorizing incidents      | Use SELECT type  |
| Linking to external systems | Use URL type     |
| Tracking numeric metrics    | Use NUMBER type  |
| Yes/no questions            | Use BOOLEAN type |
| Free-form notes             | Use TEXT type    |

---

## Related Topics

- [Incidents](../core-concepts/incidents) — Working with incidents
- [Analytics](../core-concepts/analytics) — Filtering reports by custom fields
- [Status Page](../core-concepts/status-page) — Displaying custom fields publicly
