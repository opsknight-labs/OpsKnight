---
order: 2
---

# Settings Architecture

## Entry Points

Settings pages live under `src/app/(app)/settings` and are grouped by area:

- `/settings` (overview)
- `/settings/profile`
- `/settings/security`
- `/settings/notifications`
- `/settings/status-page`
- `/settings/system/*`
- `/settings/integrations/*`
- `/settings/api-keys`

Navigation is defined in `src/components/settings/navConfig.ts` and rendered by the settings
layout shell.

---

## Layout & Shell Components

Core layout components:

```
src/components/settings/
├── SettingsShell.tsx
├── SettingsLayoutShell.tsx
├── SettingsPage.tsx
├── SettingsPageHeader.tsx
├── SettingsSectionCard.tsx
├── SettingsHeader.tsx
├── SettingsSearch.tsx
└── SettingsEmptyState.tsx
```

These components provide consistent layout, navigation, and section styling across settings
pages.

---

## Notification Providers

Admin-only provider configuration:

- Page: `src/app/(app)/settings/notifications/page.tsx`
- Core UI: `src/components/settings/SystemNotificationSettings.tsx`
- Supporting components: `ProviderCard`, `NotificationProviderTabs`,
  `SmsProviderSettings`, `WhatsappProviderSettings`

Provider support is grounded in code:

- **Email**: Resend, SendGrid, SMTP, SES (`src/lib/notification-providers.ts`)
- **SMS**: Twilio or AWS SNS (`src/lib/sms.ts`)
- **Push**: Web Push (`src/lib/push.ts`)
- **WhatsApp**: Twilio (`src/lib/whatsapp.ts`)

---

## System & Security Settings

Key system settings components:

- `RetentionPolicySettings` (data retention policy)
- `AppUrlSettings` (base URL for links)
- `EncryptionKeyForm` (encryption settings)
- `RoleMappingEditor` / `SsoSettingsForm` (OIDC / SSO configuration)

Most settings pages use server actions defined in:

- `src/app/(app)/settings/actions.ts`
- `src/app/(app)/settings/system/actions.ts`
- `src/app/(app)/settings/security/actions.ts`

Access control is enforced via RBAC helpers in `src/lib/rbac.ts`.
