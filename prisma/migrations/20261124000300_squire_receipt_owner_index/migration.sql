-- Squire action history lists one person's receipts newest first; without this it scans every receipt.
CREATE INDEX "idx_squire_action_receipt_owner" ON "SquireActionReceipt"("userId", "createdAt" DESC, "id" DESC);
