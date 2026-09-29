---
title: Manage incident templates
description: Create reusable incident defaults and control who can use them.
type: how-to
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/incidents/templates]
---

# Manage incident templates

## Before you begin

Confirm template-management permission, intended visibility, and the service
defaults responders should inherit.

1. Open **Incidents → Templates** and create a template.
2. Set its name, visibility, title, description, urgency, priority, and service.
3. Create a synthetic incident from it and verify every inherited value.
4. Edit or delete the template only after reviewing its future users.

Incident templates provide reusable title, description, urgency, priority, and
service defaults. Public templates are available to permitted responders;
private templates remain scoped to their creator where the UI offers that
visibility choice.

Create a template from **Incidents → Templates**, give it a recognizable name,
set only durable defaults, and test it through the incident creation form.
Editing or deleting a template affects future use only; it does not rewrite
existing incidents created from the template.

If a template is unavailable, verify its visibility, creator status, service
access, and your incident-creation permission. If defaults are stale, edit the
template rather than correcting every newly created incident.
