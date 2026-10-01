---
title: Manage your profile and preferences
order: 2
description: Update your identity, personal notification channels, timezone, quiet hours, and review team and on-call context.
type: how-to
product_area: users
audience: [responder, administrator]
reader: { status: READER_COMPLETE, task: Review and update the current user's profile and response preferences. }
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/app/(app)/settings/profile/page.tsx
    - src/components/settings/ProfileDetailTabs.tsx
    - src/components/settings/ProfileForm.tsx
    - src/components/settings/NotificationPreferencesForm.tsx
    - src/components/settings/QuietHoursForm.tsx
---

# Manage your profile and preferences

## Before you begin

Sign in as the user whose preferences you are changing. Ask an administrator to
configure email, SMS, voice, WhatsApp, or Web Push providers first. Have a valid
phone number for phone-based channels and know the timezone in which quiet hours
should run.

## Open the feature

Open **Settings → Profile**. The page contains **Profile & Identity**,
**Notifications**, **Timezone & Quiet Hours**, and **Teams & On-Call** tabs.

## Configure your profile

1. Under **Profile & Identity**, update your display name, department, job title,
   and avatar. Email, role, account status, and OIDC-synchronized identity values
   may be controlled by an administrator or identity provider.
2. Under **Notifications**, verify the phone number and enable only the personal
   channels you can receive: email, SMS, voice, push, or WhatsApp.
3. Under **Timezone & Quiet Hours**, select the timezone used for timestamps,
   schedules, and analytics. Enable quiet hours, set start/end times, and choose
   whether weekends are quiet all day.
4. Under **Teams & On-Call**, review team membership, teams you lead, schedule
   layers, escalation-policy participation, and the last-30-day response/SLA
   summary. These views are informational; change ownership in the relevant team,
   schedule, or policy workflow.
5. Wait for the save indicator to confirm each editable change, then reload the
   page and verify the value persisted.

## How the profile works

Personal channel switches participate in notification eligibility; they do not
configure provider credentials or service routing. SMS, voice, and WhatsApp
require a usable phone number. Quiet hours suppress low-urgency SMS, voice, push,
and WhatsApp during the configured window; the current UI states that P1 and P2
alerts bypass quiet hours. Timezone affects displayed timestamps and schedule
context. Team, schedule, policy, incident, and SLA cards reflect current records
the signed-in user may see.

## Verify the result

Send a controlled notification through an enabled channel and confirm the
recipient and provider outcome. Check timestamps in the selected timezone. When
safe, test one low-urgency notification inside the quiet window and a higher
urgency event to confirm the intended bypass behavior.

## Change or undo it

Restore the prior value in the same tab and wait for the save indicator. Before
disabling the only usable personal channel, arrange and test an alternative.
Team, on-call, or escalation changes must be undone in their owning feature.

## Troubleshooting

- **A channel is enabled but nothing arrives:** check endpoint data, provider
  health, service routing, quiet hours, incident urgency, and delivery history.
- **A value returns after editing:** confirm the save indicator; identity fields
  may be synchronized from OIDC or SCIM.
- **Timezone looks wrong:** verify the selected IANA timezone, reload, and compare
  the displayed local time with a known clock.
- **Membership or on-call data is wrong:** correct the team, schedule layer, or
  escalation policy; the profile tab is a read-only summary of those assignments.

## Next steps

- [Configure responder notification preferences](../notifications/user-preferences)
- [Manage teams](../teams/manage-team)
- [Build an on-call schedule](../on-call/build-schedule)
- [Inspect notification delivery](../notifications/inspect-delivery)
