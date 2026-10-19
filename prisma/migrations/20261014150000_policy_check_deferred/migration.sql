ALTER TABLE "RunbookPolicyCheck" DROP CONSTRAINT "RunbookPolicyCheck_status_check";
ALTER TABLE "RunbookPolicyCheck" ADD CONSTRAINT "RunbookPolicyCheck_status_check" CHECK (status IN ('PENDING','PASSED','BLOCKED','DEFERRED'));
