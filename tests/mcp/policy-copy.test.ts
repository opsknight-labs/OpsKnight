import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { describeMcpScope, supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import {
  MCP_CONSENT_WRITES_OFF_NOTE,
  MCP_DIRECT_INCIDENT_ACTIONS,
  MCP_FALSE_APPROVAL_CLAIM,
  MCP_WRITE_MODE_HINT,
  MCP_WRITE_MODE_SUMMARY,
  MCP_WRITE_SCOPE_GROUP_DESCRIPTION,
  MCP_WRITE_SCOPE_GROUP_TITLE,
} from '@/lib/mcp/policy-copy';

// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths below
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/** Every screen that describes what assistant changes do. */
const SCREENS = [
  'src/app/(app)/settings/integrations/mcp/page.tsx',
  'src/app/(app)/settings/integrations/mcp/approvals/[id]/page.tsx',
  'src/app/(app)/settings/integrations/mcp/approvals/operations/[id]/page.tsx',
  'src/app/(app)/settings/integrations/mcp/approvals/review-gate.tsx',
  'src/app/(app)/settings/integrations/mcp/approvals/ReviewForm.tsx',
  'src/app/oauth/mcp/consent/ConsentView.tsx',
  'src/app/oauth/mcp/consent/ConsentForm.tsx',
  'src/components/settings/mcp/McpPolicyForm.tsx',
  'src/components/settings/mcp/McpPolicyScopeSelector.tsx',
  'src/components/settings/mcp/McpClientScopeSelector.tsx',
  'src/components/settings/mcp/sections/McpOverviewSection.tsx',
  'src/components/settings/mcp/sections/McpPolicySection.tsx',
  'src/components/settings/mcp/sections/McpApprovalsSection.tsx',
];

describe('SEC-2 / UX-1 accurate change copy', () => {
  it('names only incident actions that really run directly', () => {
    const direct = MCP_CATALOG.filter(
      operation =>
        operation.risk === 'R1' &&
        operation.domain === 'incidents' &&
        isMcpExecutable(operation) &&
        !isMcpApprovalGated(operation)
    ).map(operation => operation.operationId.toLowerCase());
    for (const action of MCP_DIRECT_INCIDENT_ACTIONS)
      expect(
        direct.some(id => id.includes(action)),
        `${action} is not a direct R1 incident operation`
      ).toBe(true);
  });

  it('never says every change needs approval', () => {
    for (const copy of [
      MCP_WRITE_MODE_SUMMARY,
      MCP_WRITE_SCOPE_GROUP_TITLE,
      MCP_WRITE_SCOPE_GROUP_DESCRIPTION,
      MCP_WRITE_MODE_HINT.on,
      MCP_CONSENT_WRITES_OFF_NOTE,
    ])
      expect(copy).not.toMatch(MCP_FALSE_APPROVAL_CLAIM);
    for (const path of SCREENS) expect(source(path), path).not.toMatch(MCP_FALSE_APPROVAL_CLAIM);
    // Scopes that cover a direct write are described without the false claim too.
    for (const scope of supportedMcpScopes())
      expect(describeMcpScope(scope)).not.toMatch(MCP_FALSE_APPROVAL_CLAIM);
  });

  it('never says every incident action runs directly while some wait for approval', () => {
    // Snooze, suppress, reopen and incident edits are approval-gated R2 operations.
    const gated = MCP_CATALOG.filter(
      operation =>
        operation.domain === 'incidents' &&
        operation.method !== 'get' &&
        isMcpApprovalGated(operation)
    );
    expect(gated.length).toBeGreaterThan(0);
    for (const copy of [
      MCP_WRITE_MODE_SUMMARY,
      MCP_WRITE_SCOPE_GROUP_DESCRIPTION,
      MCP_WRITE_MODE_HINT.on,
      MCP_CONSENT_WRITES_OFF_NOTE,
    ])
      // Each clause that says incident actions run directly must qualify them as routine.
      for (const clause of copy.toLowerCase().split(/[.;]/))
        if (clause.includes('incident actions') && clause.includes('direct'))
          expect(clause, copy).toContain('routine incident actions');
  });

  it('says both halves: incident actions run directly, the rest waits for a human', () => {
    expect(MCP_WRITE_MODE_SUMMARY).toMatch(/run directly/);
    expect(MCP_WRITE_MODE_SUMMARY).toMatch(/runbook approver/);
    expect(MCP_CONSENT_WRITES_OFF_NOTE).toMatch(/routine incident actions then run directly/);
    // The screens render the shared strings, not their own wording.
    expect(source('src/components/settings/mcp/McpPolicyForm.tsx')).toContain(
      'MCP_WRITE_MODE_SUMMARY'
    );
    expect(source('src/components/settings/mcp/McpPolicyScopeSelector.tsx')).toContain(
      'MCP_WRITE_SCOPE_GROUP_DESCRIPTION'
    );
    expect(source('src/app/oauth/mcp/consent/ConsentView.tsx')).toContain(
      'MCP_CONSENT_WRITES_OFF_NOTE'
    );
    expect(source('src/app/(app)/settings/integrations/mcp/page.tsx')).toContain(
      'MCP_WRITE_MODE_VALUE'
    );
    expect(source('src/components/settings/mcp/sections/McpOverviewSection.tsx')).toContain(
      'MCP_WRITE_MODE_HINT'
    );
  });
});
