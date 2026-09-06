ALTER TABLE "Integration" ADD COLUMN "snsTopicArn" TEXT;

CREATE INDEX "Integration_type_snsTopicArn_idx"
ON "Integration"("type", "snsTopicArn");
