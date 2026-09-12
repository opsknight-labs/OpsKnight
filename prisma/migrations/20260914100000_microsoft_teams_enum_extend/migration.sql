-- Extend existing enums (must be isolated per OpsKnight migration rules)
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'MICROSOFT_TEAMS';
ALTER TYPE "NotificationRecipientType" ADD VALUE IF NOT EXISTS 'MICROSOFT_TEAMS_CHANNEL';
