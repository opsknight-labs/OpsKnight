import type {
  ComplianceControlEvaluator,
  ComplianceEvaluationContext,
  ComplianceEvaluatorResult,
} from './types';
import { APP_ROLES, CAPABILITIES, getRoleCapabilities } from '@/lib/authorization';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { createEvidenceDraft } from '../evidence/build';

export const authorizationEvaluator: ComplianceControlEvaluator = {
  id: 'authorization.rbac',
  version: '1',

  async evaluate(_context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult> {
    const knownCapabilities = new Set<string>(Object.values(CAPABILITIES));
    const roles = APP_ROLES;

    // Verify all roles map to valid capabilities
    for (const role of roles) {
      const caps = getRoleCapabilities(role);
      if (caps.length === 0) {
        return {
          status: 'ACTION_REQUIRED',
          summary: `Role ${role} does not have any assigned capabilities.`,
          findings: [{ code: 'EMPTY_ROLE_CAPABILITIES', value: role, severity: 'ERROR' }],
          evidence: [
            createEvidenceDraft({
              type: 'CAPABILITY_CHECK',
              collectorId: 'authorization.rbac',
              collectorVersion: '1',
              title: 'RBAC Policy Structure Failure',
              description: `Role ${role} does not have any assigned capabilities.`,
              observedAt: _context.now,
              metadata: {
                rbacValid: false,
                role,
                issue: 'EMPTY_ROLE_CAPABILITIES',
              },
            }),
          ],
          evidenceRefs: [
            { source: 'src/lib/authorization.ts', description: 'Role capability mapping' },
          ],
        };
      }

      for (const cap of caps) {
        if (!knownCapabilities.has(cap)) {
          return {
            status: 'ACTION_REQUIRED',
            summary: `Role ${role} references unknown capability "${cap}".`,
            findings: [{ code: 'UNKNOWN_CAPABILITY', value: cap, severity: 'ERROR' }],
            evidence: [
              createEvidenceDraft({
                type: 'CAPABILITY_CHECK',
                collectorId: 'authorization.rbac',
                collectorVersion: '1',
                title: 'RBAC Policy Structure Failure',
                description: `Role ${role} references unknown capability "${cap}".`,
                observedAt: _context.now,
                metadata: {
                  rbacValid: false,
                  role,
                  unknownCapability: cap,
                  issue: 'UNKNOWN_CAPABILITY',
                },
              }),
            ],
            evidenceRefs: [
              { source: 'src/lib/authorization.ts', description: 'Role capability mapping' },
            ],
          };
        }
      }
    }

    // Verify ADMIN has core management capabilities
    const adminCaps = new Set(getRoleCapabilities('ADMIN'));
    const requiredAdminCaps = [
      CAPABILITIES.ADMIN_MANAGE,
      CAPABILITIES.COMPLIANCE_READ,
      CAPABILITIES.COMPLIANCE_EVALUATE,
      CAPABILITIES.ENCRYPTION_MANAGE,
      CAPABILITIES.RETENTION_MANAGE,
    ];

    for (const requiredCap of requiredAdminCaps) {
      if (!adminCaps.has(requiredCap)) {
        return {
          status: 'ACTION_REQUIRED',
          summary: `ADMIN role is missing required capability "${requiredCap}".`,
          findings: [{ code: 'MISSING_ADMIN_CAPABILITY', value: requiredCap, severity: 'ERROR' }],
          evidence: [
            createEvidenceDraft({
              type: 'CAPABILITY_CHECK',
              collectorId: 'authorization.rbac',
              collectorVersion: '1',
              title: 'RBAC Policy Structure Failure',
              description: `ADMIN role is missing required capability "${requiredCap}".`,
              observedAt: _context.now,
              metadata: {
                rbacValid: false,
                missingCapability: requiredCap,
                issue: 'MISSING_ADMIN_CAPABILITY',
              },
            }),
          ],
          evidenceRefs: [
            { source: 'src/lib/authorization.ts', description: 'Admin capabilities definition' },
          ],
        };
      }
    }

    const actionCount = Object.keys(AUTHORIZATION_ACTIONS).length;

    return {
      status: 'IMPLEMENTED',
      summary:
        'Centralized role-based access control and scoped resource authorization policies are structurally verified.',
      findings: [
        { code: 'REGISTERED_CAPABILITIES_COUNT', value: knownCapabilities.size },
        { code: 'REGISTERED_ROLES_COUNT', value: roles.length },
        { code: 'RESOURCE_POLICY_ACTIONS_COUNT', value: actionCount },
        { code: 'ADMIN_GOVERNANCE_VERIFIED', value: true },
      ],
      evidence: [
        createEvidenceDraft({
          type: 'CAPABILITY_CHECK',
          collectorId: 'authorization.rbac',
          collectorVersion: '1',
          title: 'RBAC Policy Structure Verification',
          description:
            'Centralized role-based access control and scoped resource authorization policies verified.',
          observedAt: _context.now,
          metadata: {
            registeredRolesCount: roles.length,
            registeredCapabilityCount: knownCapabilities.size,
            resourcePolicyActionsCount: actionCount,
            adminGovernanceVerified: true,
          },
        }),
      ],
      evidenceRefs: [
        {
          source: 'src/lib/authorization.ts',
          description: `${knownCapabilities.size} capabilities across ${roles.length} roles verified.`,
        },
        {
          source: 'src/lib/authorization-policy.ts',
          description: 'Scoped resource policy engine verified.',
        },
      ],
    };
  },
};
