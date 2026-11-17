-- A rollback restores pipeline order too: record it on each version, nullable (null = OFF). Metadata-only change.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "NoiseControlPolicyVersion"
  ADD COLUMN "pipelineOrder" "NoiseControlMode";
