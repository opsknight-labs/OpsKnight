ALTER TABLE "SystemSettings" ADD COLUMN "automationStoreObservationPreviews" BOOLEAN NOT NULL DEFAULT false;
-- Diagnostic samples used unkeyed hashes and cannot be safely re-keyed without
-- retaining raw values. Reset these bounded discovery statistics during upgrade.
-- Incident decisions, traces, published rules and shadow aggregates are preserved.
DELETE FROM "AutomationContextObservation";
