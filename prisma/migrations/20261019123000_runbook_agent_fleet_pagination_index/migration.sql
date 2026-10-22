-- Support bounded Agent fleet keyset pagination without sorting the entire fleet.
CREATE INDEX "RunbookAgent_createdAt_id_idx" ON "RunbookAgent"("createdAt", "id");
