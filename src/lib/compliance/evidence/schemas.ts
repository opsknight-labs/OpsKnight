import { z } from 'zod';

// ==========================================
// 1. Encryption Evaluator (encryption.at-rest)
// ==========================================

const encryptionSummarySchema = z
  .object({
    runId: z.string().min(1),
    registryFingerprint: z.string().min(1),
    verificationActiveKeyId: z.string().nullable(),
    currentActiveKeyId: z.string().min(1),
    expectedTargets: z.number().int().nonnegative(),
    verifiedTargets: z.number().int().nonnegative(),
    currentV3: z.number().int().nonnegative(),
    oldKeyV3: z.number().int().nonnegative(),
    legacyV2: z.number().int().nonnegative(),
    legacyV1: z.number().int().nonnegative(),
    plaintext: z.number().int().nonnegative(),
    unavailableKey: z.number().int().nonnegative(),
    ambiguous: z.number().int().nonnegative(),
    unreadable: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    blockingIssues: z.number().int().nonnegative(),
    legacyRecords: z.number().int().nonnegative(),
  })
  .strict();

const encryptionRunMissingSchema = z
  .object({
    completedVerifyRunFound: z.literal(false),
    activeKeyId: z.string().min(1),
  })
  .strict();

const encryptionFingerprintMismatchSchema = z
  .object({
    runId: z.string().min(1),
    runFingerprint: z.string().min(1),
    currentFingerprint: z.string().min(1),
    fingerprintMatches: z.literal(false),
  })
  .strict();

const encryptionActiveKeyMismatchSchema = z
  .object({
    runId: z.string().min(1),
    verificationActiveKeyId: z.string().nullable(),
    currentActiveKeyId: z.string().min(1),
    keyMatches: z.literal(false),
  })
  .strict();

const encryptionIncompleteCoverageSchema = z
  .object({
    runId: z.string().min(1),
    expectedTargets: z.number().int().nonnegative(),
    verifiedTargets: z.number().int().nonnegative(),
    missingTargetCount: z.number().int().nonnegative(),
    incompleteTargetCount: z.number().int().nonnegative(),
  })
  .strict();

const encryptionFailureSchema = z
  .object({
    activeKeyConfigured: z.literal(false),
    errorCode: z.string().min(1),
  })
  .strict();

export const encryptionEvidenceSchema = z.union([
  encryptionSummarySchema,
  encryptionRunMissingSchema,
  encryptionFingerprintMismatchSchema,
  encryptionActiveKeyMismatchSchema,
  encryptionIncompleteCoverageSchema,
  encryptionFailureSchema,
]);

// ==========================================
// 2. Retention Evaluator (data.retention)
// ==========================================

const retentionConfigSnapshotSchema = z
  .object({
    incidentRetentionDays: z.number().int().positive(),
    alertRetentionDays: z.number().int().positive(),
    logRetentionDays: z.number().int().positive(),
    metricsRetentionDays: z.number().int().positive(),
    completedPrivacyRequestRetentionDays: z.number().int().positive(),
  })
  .strict();

const retentionSystemStateSchema = z
  .object({
    activeRetentionHolds: z.number().int().nonnegative(),
    holdSubsystemOperational: z.literal(true),
  })
  .strict();

const retentionSettingsMissingSchema = z
  .object({
    settingsFound: z.literal(false),
  })
  .strict();

export const retentionEvidenceSchema = z.union([
  retentionConfigSnapshotSchema,
  retentionSystemStateSchema,
  retentionSettingsMissingSchema,
]);

// ==========================================
// 3. Privacy Evaluators (privacy.holds, privacy.erasure, privacy.export)
// ==========================================

export const privacyHoldsEvidenceSchema = z
  .object({
    supportedScopes: z.array(z.string().min(1)).min(1),
    activeHoldCount: z.number().int().nonnegative(),
    cleanupFencingAvailable: z.literal(true),
  })
  .strict();

export const privacyErasureEvidenceSchema = z
  .object({
    subjectDiscoveryAvailable: z.literal(true),
    erasureExecutionEngineAvailable: z.literal(true),
    registeredPersonalDataDomains: z.number().int().positive(),
    historicalErasuresCount: z.number().int().nonnegative(),
  })
  .strict();

export const privacyExportEvidenceSchema = z
  .object({
    subjectDiscoveryAvailable: z.literal(true),
    encryptedExportArtifactsAvailable: z.literal(true),
    artifactExpirySupported: z.literal(true),
    historicalArtifactsCount: z.number().int().nonnegative(),
  })
  .strict();

// ==========================================
// 4. Authorization Evaluator (authorization.rbac)
// ==========================================

const authorizationRbacSuccessSchema = z
  .object({
    registeredRolesCount: z.number().int().positive(),
    registeredCapabilityCount: z.number().int().positive(),
    resourcePolicyActionsCount: z.number().int().positive(),
    adminGovernanceVerified: z.literal(true),
  })
  .strict();

const authorizationRbacErrorSchema = z
  .object({
    rbacValid: z.literal(false),
    role: z.string().optional(),
    unknownCapability: z.string().optional(),
    missingCapability: z.string().optional(),
    issue: z.string().min(1),
  })
  .strict();

export const authorizationEvidenceSchema = z.union([
  authorizationRbacSuccessSchema,
  authorizationRbacErrorSchema,
]);

// ==========================================
// 5. Generic Engine & Failure Schema
// ==========================================

export const evaluationFailureEvidenceSchema = z
  .object({
    controlId: z.string().min(1),
    evaluatorId: z.string().min(1),
    evaluatorVersion: z.string().optional(),
    runtimeError: z.boolean().optional(),
    validationFailure: z.boolean().optional(),
    errorCode: z.string().optional(),
  })
  .strict();

// Registry of exact per-collector schemas
export const COLLECTOR_EVIDENCE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'encryption.at-rest': encryptionEvidenceSchema,
  'data.retention': retentionEvidenceSchema,
  'privacy.holds': privacyHoldsEvidenceSchema,
  'privacy.erasure': privacyErasureEvidenceSchema,
  'privacy.export': privacyExportEvidenceSchema,
  'authorization.rbac': authorizationEvidenceSchema,
};
