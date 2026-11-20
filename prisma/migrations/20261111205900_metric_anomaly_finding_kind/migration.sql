-- Enum addition split out of 20261111210000_metric_anomaly_evidence: ALTER TYPE ... ADD VALUE must not share a migration with other DDL.
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'METRIC_ANOMALY';
