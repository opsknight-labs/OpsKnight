---
order: 3
title: Custom Fields
description: Add organization-wide incident metadata with safe expectations for validation and visibility
---

# Custom Fields

Custom fields add organization-wide metadata to incidents. They are useful for values such as an environment, customer tier, ticket reference, or affected region. Create only fields that operators need during an incident: every field becomes part of the incident workflow.

## Create a field

An administrator can open **Settings → Custom Fields**, choose **Add Field**, and provide the field configuration.

| Setting       | Stored behavior                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Name          | Required display label, 1–200 characters.                                                                           |
| Key           | Unique identifier, 1–100 characters; letters, numbers, and underscores only. The UI converts spaces to underscores. |
| Type          | `TEXT`, `NUMBER`, `DATE`, `SELECT`, `BOOLEAN`, `URL`, or `EMAIL`.                                                   |
| Required      | When a value is submitted through the incident custom-field endpoint, an empty required value is rejected.          |
| Default value | Optional string stored with the field.                                                                              |
| Options       | Optional JSON value, normally used by a `SELECT` field. The UI accepts comma-separated options.                     |
| Show in list  | Controls whether the field is intended for incident-list display; default is off.                                   |

Choose a stable, descriptive key such as `environment`, `customer_tier`, or `ticket_id`. A key is unique across the workspace, so treat it as a durable identifier rather than a label you will frequently rename.

## Use values on an incident

Custom-field values are stored as strings, including values associated with `NUMBER`, `DATE`, `BOOLEAN`, `URL`, and `EMAIL` field types. The current server endpoint enforces that required values are non-empty, but it does not enforce type-specific formats or verify that a `SELECT` value appears in its options.

For reliable reporting and automation, define a team convention and validate important values in the workflow that creates or updates the incident. For example:

- Use one date format, such as `YYYY-MM-DD`.
- Use a small, documented set of environment values.
- Do not assume a URL or email-shaped value has server-side format validation.
- Do not place credentials, private customer data, or other sensitive values in custom fields.

Responders and administrators can submit incident values through the signed-in application. The application uses its internal incident custom-field route; it is not a published API-key contract and should not be used as a stable external automation API.

## Status-page visibility

Status pages can be configured to show custom fields and restrict which fields are allowed there. Public status pages are visible outside your workspace, so include only information appropriate for public disclosure. A field's label, value, and even the existence of a field can reveal operational or customer context.

Before enabling a field on a status page, verify the rendered result in a non-production or controlled incident and confirm that it does not expose internal ticket links, contact details, customer names, or infrastructure identifiers.

## Change and deletion safety

The current administration UI supports creating and deleting fields. Deleting a custom field also deletes its associated incident values; this action has no built-in undo.

Before deleting a field:

1. Identify saved reports, exports, and operating procedures that depend on its key.
2. Export or record the values that must be retained.
3. Remove the field from status-page visibility and team templates.
4. Tell responders which replacement field or convention to use.
5. Delete it only after the migration is complete.

If you need a different name or data convention, prefer creating a new field and migrating active workflows rather than assuming existing historical values will be transformed automatically.

## Troubleshooting

**A field cannot be created**

Confirm that you are an administrator, the name and key are within the length limits, and no other field already uses the key. Remove hyphens, spaces, and punctuation from the key.

**A required field still accepts an unexpected value**

Required validation checks for a non-empty value. It does not make `NUMBER`, `DATE`, `SELECT`, `URL`, or `EMAIL` values type-safe. Apply a documented convention or validate before sending the value.

**A field is visible publicly when it should not be**

Disable custom fields or remove the field from the status page's allowed fields, then check the public page using a non-authenticated browser session.

## Related topics

- [Incidents](../core-concepts/incidents)
- [Status pages](../core-concepts/status-page)
- [Authorization](../security/authorization)
- [Audit logs](./audit-logs)
