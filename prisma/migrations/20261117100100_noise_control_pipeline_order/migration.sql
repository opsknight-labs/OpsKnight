-- One pipeline, one trace (J1.5): per-scope pipeline order, nullable (null = OFF). Metadata-only change.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "NoiseControlPolicy"
  ADD COLUMN "pipelineOrder" "NoiseControlMode";
