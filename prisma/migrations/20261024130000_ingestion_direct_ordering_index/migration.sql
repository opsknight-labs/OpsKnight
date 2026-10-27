-- Workers repeatedly probe active ordering identities. A large GIN pending
-- list makes each probe inspect unrelated recently appended receipts.
-- Keep the existing compatible partial index and write its keys directly.
ALTER INDEX "IngestionReceipt_unfinished_ordering_keys_idx" SET (fastupdate = off);
-- Changing the option does not flush pending entries left by older images.
-- Drain them during the supported maintenance-window upgrade.
SELECT gin_clean_pending_list('"IngestionReceipt_unfinished_ordering_keys_idx"'::regclass);
