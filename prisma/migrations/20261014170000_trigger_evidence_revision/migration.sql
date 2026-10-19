-- Existing evidence has unknown evaluated revisions; retain NULL rather than infer current conditions.
ALTER TABLE "RunbookSuggestion" ADD COLUMN "triggerRevision" INTEGER;
ALTER TABLE "RunbookExecution" ADD COLUMN "triggerRevision" INTEGER;
