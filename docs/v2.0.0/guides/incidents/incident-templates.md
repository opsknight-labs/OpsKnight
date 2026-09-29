---
title: Manage incident templates
description: Create, use, and delete reusable incident defaults with the current 2.0 template workflow.
type: how-to
product_area: incidents
audience: [responder, administrator]
reader:
  status: READER_COMPLETE
  task: Create, use, replace, and delete an incident template.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/incidents/template-actions.ts, src/app/(app)/incidents/templates/create/page.tsx, src/components/incident/TemplateCreateForm.tsx, src/components/incident/TemplatesListClient.tsx]
---

# Manage incident templates

Incident templates provide reusable defaults for common response scenarios. In 2.0, the supported lifecycle is **create, use, and delete**. There is no template update/edit action; replace a stale template by creating its successor and then deleting the old one.

## Before you begin

Sign in as an `ADMIN` or `RESPONDER`. Decide whether every permitted responder should see the template or only its creator, and confirm access to any default service.

## Open the feature

Open **Incidents → Templates**. Select an existing template to use/delete, or **New Template** to create one.

## Configure and create a template

1. Open **Incidents → Templates**.
2. Select **New Template**.
3. Enter a unique **Template name** between 3 and 100 characters. This identifies the template in the chooser.
4. Optionally enter an internal **Description** explaining when responders should use it.
5. Enter the default incident **Title**, between 5 and 255 characters.
6. Add optional incident description/runbook content. The form previews headings, lists, bold text, inline code, and links.
7. Choose default urgency: `HIGH`, `MEDIUM`, or `LOW`.
8. Choose priority `P1` through `P5`, or leave it unset if the form permits.
9. Optionally select a default service.
10. Enable **Public** to make it visible to other permitted responders. Otherwise it remains visible to its creator.
11. Save and create a synthetic incident from the template.

Success means the template appears in **Incidents → Templates** and the incident creation flow inherits its title, description content, urgency, priority, and service. Review every inherited value before submitting the incident; a template supplies defaults, not an approval bypass.

## Visibility and ownership

The listing returns public templates plus private templates created by the current user. `ADMIN` and `RESPONDER` can create templates. A non-admin can delete only a template they created; an administrator can delete any template.

The creator relationship is ownership metadata. If you plan to disable or delete a creator, inventory private templates first and create public or replacement templates where the workflow must continue.

## What OpsKnight does

OpsKnight stores reusable defaults and applies them to the new-incident form. The resulting incident is independent: later template replacement/deletion does not rewrite incidents already created from it.

## Verify the template

Open **Create incident**, choose the new template, and confirm its title, description/runbook, urgency, priority, service, visibility, and ownership defaults populate as intended. Cancel the form or create a controlled test incident and verify the resulting incident.

## Remove or replace a template

Because 2.0 does not support editing:

1. Create a new template with a distinct temporary name and the corrected defaults.
2. Create a synthetic incident and verify every inherited value.
3. Communicate the replacement to responders and update runbooks that name the old template.
4. Delete the old template when it is no longer needed.
5. If desired, recreate the final name only after the old unique name has been removed and retest it.

Deleting a template prevents future selection. It does not rewrite incidents that were already created from it.

## Troubleshooting

## Next steps

- [Create an incident](./create)
- [Respond to an incident](./respond-to-an-incident)

- **Template Name Conflict:** names are unique; choose a different name or delete the obsolete template after validating its replacement.
- **Template is missing from the chooser:** confirm it is public or owned by the current user and that the user can create an incident for the default service.
- **Delete is denied:** only an administrator or the template creator can delete it.
- **Defaults are wrong:** there is no edit action. Create and test a replacement rather than repeatedly correcting new incidents.
- **Default service is unavailable:** confirm that the service still exists and the responder has incident-creation access.
