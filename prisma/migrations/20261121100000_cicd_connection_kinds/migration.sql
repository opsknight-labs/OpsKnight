-- Read-only CI/CD connectors (Squire get_pipeline_runs). Enum values only; expand-only.
ALTER TYPE "ObservabilityConnectionKind" ADD VALUE IF NOT EXISTS 'GITHUB_ACTIONS';
ALTER TYPE "ObservabilityConnectionKind" ADD VALUE IF NOT EXISTS 'GITLAB_CI';
