ALTER TABLE "IngestionReceipt" DROP CONSTRAINT "IngestionReceipt_status_check";
ALTER TABLE "IngestionReceipt" ADD CONSTRAINT "IngestionReceipt_status_check"
  CHECK ("status" IN ('PENDING','PROCESSING','COMPLETED','DEAD','ARCHIVED'));
