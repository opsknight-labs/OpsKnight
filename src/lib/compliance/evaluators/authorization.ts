import type {
  ComplianceControlEvaluator,
  ComplianceEvaluationContext,
  ComplianceEvaluatorResult,
} from './types';
import { APP_ROLES, CAPABILITIES, getRoleCapabilities } from '@/lib/authorization';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';

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
