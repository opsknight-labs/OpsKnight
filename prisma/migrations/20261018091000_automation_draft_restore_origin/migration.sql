-- Preserve the immutable source identity when a restored draft is edited and
-- published. Like AutomationVersion.sourceVersionId, this is historical metadata.
ALTER TABLE "AutomationDraft" ADD COLUMN "restoredFromVersionId" TEXT;
