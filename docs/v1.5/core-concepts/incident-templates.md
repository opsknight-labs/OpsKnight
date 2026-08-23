---
title: Incident Templates
description: Standardize manual incident creation with reusable defaults
order: 8
---

# Incident Templates

Incident templates prefill the manual incident form with a known title, description, urgency, priority, and service. Use them for recurring response patterns such as a database outage, failed deployment, or customer-impacting latency.

Templates do not ingest monitoring events and do not replace service integration keys. For automated incidents, use an [integration](../integrations) or the [Events API](../api/events).

## Who can manage templates

- Responders and administrators can create templates.
- A creator can delete their own template.
- A **public** template is available to everyone in the installation.
- A private template is visible to its creator.

## Create a template

1. Open **Incidents**.
2. Open **Incident Templates** and select **Create Template**.
3. Enter a unique template name of 3–100 characters.
4. Optionally add an internal description explaining when to use it.
5. Choose whether the template is public.
6. Configure the default incident values: title (5–255 characters), description, urgency, priority, and service.
7. Save the template.

The template list shows its visibility, default urgency, priority, service, and title.

## Create an incident from a template

1. Open **Incidents → Incident Templates**.
2. Find the template and select **Use Template**.
3. Review every prefilled value. Change details that are specific to this occurrence.
4. Create the incident.
5. Confirm the incident has the expected service, urgency, priority, and escalation behavior.

A template accelerates data entry; it does not bypass permissions, validation, service routing, or escalation rules.

## Delete a template

The creator can open the template's action menu and choose **Delete Template**. Deletion is immediate after confirmation and does not change incidents that were previously created from that template.

## Troubleshooting

| Problem                                   | Check                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Create Template** is unavailable        | Your account must be a responder or administrator.                                               |
| A private template is missing             | Sign in as the user who created it.                                                              |
| A public template is missing              | Refresh the template list and confirm it was saved as public.                                    |
| The service is not available              | Create the service first or ask an administrator to check access.                                |
| The created incident does not page anyone | Verify the selected service has an escalation policy and that its schedule has current coverage. |

## Related guides

- [Incidents](./incidents)
- [Services](./services)
- [Escalation policies](./escalation-policies)
- [Events API](../api/events)
