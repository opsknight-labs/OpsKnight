-- Read-only Kubernetes connector (Squire get_k8s_state). Enum value only; expand-only.
ALTER TYPE "ObservabilityConnectionKind" ADD VALUE IF NOT EXISTS 'KUBERNETES';
