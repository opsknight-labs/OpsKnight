export type GateStatus = 'PASS' | 'FAIL' | 'SKIPPED';

export interface GateResult {
  gateNumber: number;
  gateName: string;
  category: string;
  status: GateStatus;
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface CertificationEnvironmentInfo {
  commit: string;
  imageDigest: string;
  databaseVersion: string;
  nodeVersion: string;
  deploymentMode: 'docker-compose' | 'aws-spot' | 'local';
  environment: string;
  timestamp: string;
  baseUrl: string;
  mailpitUrl?: string;
}

export interface Phase4CertificationSummary {
  certified: boolean;
  totalGates: number;
  passedGates: number;
  failedGates: number;
  skippedGates: number;
  score: string; // e.g. "18 / 18 PASS"
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  environment: CertificationEnvironmentInfo;
  gates: GateResult[];
}
