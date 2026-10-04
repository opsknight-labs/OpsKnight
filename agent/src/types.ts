export type StepType = 'LINUX_DIAGNOSTICS' | 'SYSTEMD' | 'DOCKER' | 'KUBERNETES' | 'BASH';

export type RiskClass = 'READ_ONLY' | 'IDEMPOTENT_WRITE' | 'NON_IDEMPOTENT';

export interface AgentPolicy {
  allowedStepTypes: StepType[];
  allowNonIdempotent: boolean;
  systemdUnits: string[];
  dockerContainers: string[];
  kubernetesNamespaces: string[];
  bashCommandPatterns: string[];
  maxRuntimeSeconds: number;
  maxOutputBytes: number;
  podmanContainers?: string[];
  kubernetesActions?: string[];
  kubernetesMaxReplicas?: number;
  networkHosts?: string[];
  networkPorts?: number[];
}

export interface AgentIdentity {
  agentId: string;
  privateKey: string;
  publicKey: string;
}

export interface ClaimedAttempt {
  signature?: string;
  signingKeyId?: string;
  signingAgentId?: string;
  executionDeadlineAt?: string;
  definitionChecksum?: string;
  attemptId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  idempotencyKey: string | null;
  planDigest: string | null;
  executionId: string;
  step: {
    key: string;
    name: string;
    type: StepType;
    riskClass: RiskClass;
    config: Record<string, unknown>;
    timeoutSeconds: number | null;
  };
  inputValues: Record<string, unknown>;
  secretInputKeys: string[];
}

export interface SpoolRecord {
  localOutput?: string;
  attemptId: string;
  leaseToken: string;
  producedAt: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  exitCode?: number;
  outputPreview?: string;
  outputArtifactId?: string;
  errorCode?: string;
  errorMessage?: string;
  preState?: Record<string, unknown>;
  postState?: Record<string, unknown>;
}
