/**
 * Core types for controlled encryption migration, ciphertext inspection,
 * and key retirement readiness.
 */

export type CiphertextClassification =
  | 'CURRENT_V3'
  | 'OLD_KEY_V3'
  | 'LEGACY_V2'
  | 'LEGACY_V1'
  | 'PLAINTEXT'
  | 'UNAVAILABLE_KEY'
  | 'AMBIGUOUS'
  | 'UNREADABLE'
  | 'EMPTY';

export type EncryptionStorageType = 'SCALAR' | 'JSON_FIELD' | 'USER_DEVICE_TOKEN';

export interface EncryptionTargetDefinition {
  id: string;
  model: string;
  field: string;
  storageType: EncryptionStorageType;
  jsonKeys?: string[];
  plaintextLegacyAllowed: boolean;
  label: string;
  description: string;
  filter?: Record<string, unknown>;
}

export type MigrationMode = 'PREVIEW' | 'MIGRATE' | 'VERIFY';

export type MigrationStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface KeyringKeyInfo {
  id: string;
  source: 'env' | 'database_legacy';
  isActive: boolean;
}

export interface KeyringMetadata {
  activeKeyId: string | null;
  keys: KeyringKeyInfo[];
  totalKeys: number;
  hasLegacyDbKey: boolean;
}

export interface KeyRetirementAssessment {
  keyId: string;
  status: 'DATABASE_READY_FOR_RETIREMENT' | 'ACTIVE_KEY' | 'ACTIVE_REFERENCES_EXIST' | 'UNVERIFIED';
  remainingReferences: number;
  targetsWithReferences: string[];
  message: string;
  guidance: string;
}

export interface KeyRetirementReport {
  evaluatedAt: string;
  registryFingerprint: string;
  verifiedRunId: string | null;
  verifiedRunCompletedAt: string | null;
  activeKeyId: string | null;
  assessments: KeyRetirementAssessment[];
  allEligibleRetiredFromDatabase: boolean;
}

export interface TargetInspectionStats {
  targetId: string;
  totalRecords: number;
  currentV3: number;
  oldKeyV3: number;
  legacyV2: number;
  legacyV1: number;
  plaintext: number;
  unavailableKey: number;
  ambiguous: number;
  unreadable: number;
  empty: number;
  keysDetected: Record<string, number>;
}

export interface RunSummaryStats {
  totalRecords: number;
  processedRecords: number;
  migratedRecords: number;
  errorRecords: number;
  skippedRecords: number;
  conflictRecords: number;
}
