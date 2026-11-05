-- Extend existing enums (must be isolated per OpsKnight migration rules)
ALTER TYPE "InAppNotificationType" ADD VALUE IF NOT EXISTS 'SYSTEM';
