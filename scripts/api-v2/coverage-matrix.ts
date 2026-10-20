/* eslint-disable security/detect-non-literal-fs-filename -- paths come from the checked-in route registry and inventory, never HTTP input */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';
import { V2_OPERATIONS } from '../../src/lib/api-v2/openapi-registry';
import { V2_MUTATION_CONTRACT } from '../../src/lib/api-v2/mutation-contract';
import { API_CAPABILITY_CATALOG } from '../../src/lib/api-v2/capability-catalog';
import { getOpenApiV2Spec } from '../../src/lib/api-v2/openapi';
import { AUTHORIZATION_ACTIONS, authorize } from '../../src/lib/authorization-policy';
import { APP_ROLES } from '../../src/lib/authorization';

const inventory = z
  .object({
    workflows: z.array(
      z.object({
        capabilityId: z.string(),
        workflow: z.string(),
        sources: z.array(z.object({ path: z.string(), branch: z.string() })),
        requiredEvidence: z.array(z.string()),
        reviewStatus: z.string(),
        blockers: z.array(z.string()),
      })
    ),
    releaseGates: z.array(
      z.object({ id: z.string(), status: z.string(), evidence: z.array(z.unknown()) })
    ),
  })
  .parse(JSON.parse(readFileSync('plans/rest-api-enterprise/workflow-inventory.json', 'utf8')));
const spec = getOpenApiV2Spec() as unknown as {
  paths: Record<string, Record<string, { requestBody?: unknown; responses?: unknown }>>;
};
const actions = new Map(Object.entries(AUTHORIZATION_ACTIONS));
const schemas = new Map(Object.entries(spec.paths));
const contracts = new Map(Object.entries(V2_MUTATION_CONTRACT));
const reviewedOperationIds = new Set([
  'listTeamMembers',
  'setTeamMember',
  'removeTeamMember',
  'getTeamLead',
  'setTeamLead',
  'listTeamServices',
  'assignTeamService',
  'listTeamActivity',
  'getUserAdministration',
  'administerUser',
  'getUserInvitationPolicy',
  'createUserInvitation',
  'getUserInvitation',
  'renewUserInvitation',
]);
const domainReviews = new Map<
  string,
  {
    sharedCommands: string[];
    uiCommands: string[];
    auditEvents: string[];
    sideEffects: string[];
    resourceAuthorization: string;
    acceptanceTests: string[];
    finalCandidateCertification: string;
  }
>([
  [
    'getUserAdministration',
    {
      sharedCommands: ['src/lib/users/administration.ts:requireUserAdministrator'],
      uiCommands: ['src/app/(app)/users/page.tsx:administrator directory'],
      auditEvents: [],
      sideEffects: [],
      resourceAuthorization:
        'Current active administrator and users:read. Explicit safe lifecycle projection, no credentials or session versions.',
      acceptanceTests: ['tests/integration/api-v2-user-administration.test.ts'],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'administerUser',
    {
      sharedCommands: [
        'src/lib/users/administration.ts:administerUser',
        'src/lib/users/admin-invariants.ts:updateUserSecurityState',
      ],
      uiCommands: ['src/app/(app)/users/actions.ts:updateUserRole/deactivateUser/reactivateUser'],
      auditEvents: [
        'user.role.updated',
        'user.deactivated',
        'user.reactivated',
        'user.sessions.revoked',
      ],
      sideEffects: [
        'Session-version increment on changes, revocation of credentials/approvals/devices on deactivation; no-op has no effects',
        'Post-commit session projection eviction',
      ],
      resourceAuthorization:
        'Current active administrator and users:write; self-change and last-active-admin guards; all-writer User revision; replay rechecks authority. Manual role source matches UI.',
      acceptanceTests: ['tests/integration/api-v2-user-administration.test.ts'],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'listTeamMembers',
    {
      sharedCommands: ['src/lib/teams/administration.ts:requireTeamAccess'],
      uiCommands: ['src/app/(app)/teams/[id]/page.tsx:membership read'],
      auditEvents: [],
      sideEffects: [],
      resourceAuthorization:
        'Current role/status and membership reloaded; scoped members see only their team. Cursor bound to team.',
      acceptanceTests: ['tests/integration/api-v2-team-administration.test.ts'],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'getTeamLead',
    {
      sharedCommands: ['src/lib/teams/administration.ts:requireTeamAccess'],
      uiCommands: ['src/app/(app)/teams/[id]/page.tsx:lead read'],
      auditEvents: [],
      sideEffects: [],
      resourceAuthorization: 'Current directory-read role or membership in this team.',
      acceptanceTests: ['tests/integration/api-v2-team-administration.test.ts'],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'setTeamMember',
    {
      sharedCommands: ['src/lib/teams/administration.ts:setTeamMembership'],
      uiCommands: [
        'src/app/(app)/teams/actions.ts:addTeamMember/updateTeamMemberRole/updateTeamMemberNotifications',
        'src/app/(app)/users/actions.ts:addUserToTeam',
      ],
      auditEvents: [
        'team.member.added',
        'team.member.role.updated',
        'team.member.notifications.updated',
      ],
      sideEffects: [
        'Transactional notification only on addition',
        'User tokenVersion only on addition/role change',
        'Local projection invalidation after commit',
        'All-writer Team revision trigger',
      ],
      resourceAuthorization:
        'Current administrator or team owner; SCIM-managed membership rejected; active target and last-active-owner checks; current authority checked on replay.',
      acceptanceTests: [
        'tests/integration/api-v2-team-administration.test.ts',
        'tests/integration/team-administration-parity.test.ts',
      ],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'removeTeamMember',
    {
      sharedCommands: ['src/lib/teams/administration.ts:deleteTeamMembership'],
      uiCommands: [
        'src/app/(app)/teams/actions.ts:removeTeamMember',
        'src/app/(app)/users/actions.ts:removeUserFromTeam',
      ],
      auditEvents: ['team.member.removed'],
      sideEffects: [
        'Transactional removal notification',
        'User tokenVersion increment',
        'Clear removed member lead designation',
        'Local projection invalidation after commit',
        'All-writer Team revision trigger',
      ],
      resourceAuthorization:
        'Current administrator or team owner; SCIM rejected; last active owner retained; replay checks current authority.',
      acceptanceTests: [
        'tests/integration/api-v2-team-administration.test.ts',
        'tests/integration/team-administration-parity.test.ts',
      ],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'setTeamLead',
    {
      sharedCommands: ['src/lib/teams/administration.ts:setTeamLead'],
      uiCommands: ['src/app/(app)/teams/actions.ts:designateTeamLead/updateTeam'],
      auditEvents: ['team.lead_updated'],
      sideEffects: ['Team revision increment for a changed designation'],
      resourceAuthorization:
        'Current administrator or team owner; SCIM rejected; selected lead must be active member; replay checks current authority.',
      acceptanceTests: [
        'tests/integration/api-v2-team-administration.test.ts',
        'tests/integration/team-administration-parity.test.ts',
      ],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'listTeamServices',
    {
      sharedCommands: [
        'src/lib/teams/administration.ts:requireTeamAccess',
        'src/app/api/v2/teams/[id]/services/route.ts:bounded service read',
      ],
      uiCommands: ['src/app/(app)/teams/[id]/page.tsx:managed services read'],
      auditEvents: [],
      sideEffects: [],
      resourceAuthorization:
        'Current directory-read role or team membership. Cursor bound to current team service assignment.',
      acceptanceTests: ['tests/integration/api-v2-team-services.test.ts'],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'assignTeamService',
    {
      sharedCommands: ['src/lib/teams/service-commands.ts:assignTeamServices'],
      uiCommands: ['src/app/(app)/teams/actions.ts:assignServicesToTeam'],
      auditEvents: ['team.services_assigned'],
      sideEffects: ['Changed Service teamId and revision; no-op does not write or audit'],
      resourceAuthorization:
        'Current administrator or destination-team owner. Only administrator may transfer from a different team. Service revision and Automation lock fence assignment. Replay rechecks current team/service authority.',
      acceptanceTests: ['tests/integration/api-v2-team-services.test.ts'],
      finalCandidateCertification: 'pending',
    },
  ],
  [
    'listTeamActivity',
    {
      sharedCommands: ['src/lib/teams/activity.ts:listTeamActivity'],
      uiCommands: ['src/app/(app)/teams/[id]/page.tsx:administrative timeline'],
      auditEvents: [],
      sideEffects: [],
      resourceAuthorization:
        'Current administrator or team owner; ordinary members and auditors denied. Bounded redacted business-field projection and team-bound cursor.',
      acceptanceTests: ['tests/integration/api-v2-team-activity.test.ts'],
      finalCandidateCertification: 'pending',
    },
  ],
]);
function declaredActions(source: string, method: string) {
  const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const collect = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(file) === 'AUTHORIZATION_ACTIONS'
    )
      found.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === method) collect(statement);
    if (ts.isVariableStatement(statement))
      for (const variable of statement.declarationList.declarations)
        if (ts.isIdentifier(variable.name) && variable.name.text === method) collect(variable);
  }
  return [...found].map(key => {
    const action = actions.get(key);
    if (!action) throw new Error(`Unknown authorization action ${key}`);
    return {
      action,
      roleDecisionsBeforeResource: Object.fromEntries(
        APP_ROLES.map(role => {
          const decision = authorize({
            actor: { id: 'coverage-actor', role, status: 'ACTIVE', teamIds: [] },
            action,
          });
          return [role, decision.allowed ? decision.scope : decision.reason];
        })
      ),
    };
  });
}
const operations = V2_OPERATIONS.map(operation => {
  const method = operation.method.toUpperCase();
  const relativePath = operation.path.replace(/\{(\w+)\}/g, '[$1]');
  const route = `src/app/api/v2${relativePath}/route.ts`;
  const source = readFileSync(route, 'utf8');
  const pathItem = schemas.get(operation.path);
  const contract = pathItem ? new Map(Object.entries(pathItem)).get(operation.method) : undefined;
  if (!contract) throw new Error(`Missing OpenAPI contract for ${operation.operationId}`);
  const capabilityIds = API_CAPABILITY_CATALOG.filter(capability =>
    capability.operationIds.includes(operation.operationId)
  ).map(capability => capability.id);
  return {
    operationId: operation.operationId,
    method,
    path: operation.path,
    requiredScope: operation.scope,
    route,
    routeSha256: createHash('sha256').update(source).digest('hex'),
    responseSchema: operation.schema,
    responseKind: operation.kind,
    requestBody: contract.requestBody ?? null,
    responses: contract.responses,
    authorization: declaredActions(source, method),
    mutation: contracts.get(`${method} /api/v2${relativePath}`) ?? null,
    capabilityIds,
    domainReview: domainReviews.get(operation.operationId) ?? null,
    reviewRequired: !reviewedOperationIds.has(operation.operationId),
  };
});
const capabilities = API_CAPABILITY_CATALOG.filter(
  capability => !capability.id.startsWith('baseline-')
).map(capability => {
  const workflow = inventory.workflows.find(entry => entry.capabilityId === capability.id);
  if (!workflow) throw new Error(`Missing workflow inventory for ${capability.id}`);
  return {
    ...capability,
    ...workflow,
    disposition:
      capability.status === 'restricted' ? 'separate-security-boundary' : 'complete-within-pr886',
  };
});
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
      ),
      releaseCertified: false,
      contract:
        'Runtime registry, OpenAPI and route AST are authoritative for published operations. Null domain review and reviewRequired explicitly identify unfinished manual policy/audit/parity review. Role decisions omit credential and resource checks; they are not access grants.',
      automationRuntime: {
        includedInScope: true,
        reconciliationStatus: 'pending',
        sourceBranch: 'feat/service-automation',
        strategy: 'Subsystem reconciliation; never wholesale branch merge.',
      },
      operations,
      capabilities,
      releaseGates: inventory.releaseGates,
    },
    null,
    2
  )
);
