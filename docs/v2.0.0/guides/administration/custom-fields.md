---
title: Configure incident custom fields
description: Define validated incident metadata without exposing private values unintentionally.
type: how-to
product_area: administration
audience: [administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/settings/custom-fields, src/app/api/settings/custom-fields]
---

# Configure incident custom fields

## Before you begin

Confirm the field owner, data classification, stable key, and whether its value
may appear on an incident list or public status page.

1. Open **Settings → Custom fields**.
2. Create the definition with its key, type, validation, and visibility.
3. Create a synthetic incident and enter a valid value.
4. Verify list and status-page visibility match the definition.

Custom fields add organization-specific metadata to incidents. Create and delete
definitions from **Settings → Custom fields**; incident responders supply values
on incident forms according to their permissions.

## Field contract

- Supported types are text, number, boolean, date, and select where offered by
  the current form.
- Key validation requires a stable unique key. Do not reuse a deleted key for a
  different meaning.
- Required fields must have a value before a validating mutation succeeds.
- Default values apply when a new incident is created; they do not rewrite
  existing incidents.
- Select options define the only accepted values for a select field.
- **Show in incident list** controls compact operational visibility.
- **Status page visibility** can expose a value publicly. Keep private customer,
  security, and personal data disabled.

## Change or delete a field

Review integrations and templates before changing options. Deletion removes the
definition from future workflows; verify the effect on retained incident data
and exports before confirming.

## Troubleshooting

- Duplicate key: choose a new stable key or locate the existing definition.
- Invalid key: use the character rules displayed by the form.
- Unexpected value: check the supported type and current select options.
- Accidental public exposure: disable status page visibility immediately and
  review published snapshots and audit history.
