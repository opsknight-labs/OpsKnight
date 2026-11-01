import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import {
  InvalidMcpCapabilityError,
  MCP_CAPABILITIES,
  MCP_CAPABILITY_DOMAINS,
  MCP_PROMPT_NAMES,
  canonicalMcpCapabilityEntry,
  isMcpCapabilityDisabled,
  normalizeDisabledMcpCapabilities,
  resolveDisabledMcpCapabilities,
} from '@/lib/mcp/catalog/capabilities';
import { withholdDisabledRegistrations } from '@/lib/mcp/protocol/capability-filter';
import { friendlyMcpError } from '@/lib/mcp/auth/friendly-error';
import type { McpServer } from '@modelcontextprotocol/server';

const serverSource = readFileSync(join(process.cwd(), 'src/lib/mcp/protocol/server.ts'), 'utf8');

describe('MCP capability catalogue', () => {
  it('lists every exposable catalog operation once and nothing MCP can never expose', () => {
    const ids = MCP_CAPABILITIES.map(capability => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    const exposable = MCP_CATALOG.filter(
      operation => isMcpExecutable(operation) || isMcpApprovalGated(operation)
    );
    for (const operation of exposable) expect(ids).toContain(operation.operationId);
    const denied = MCP_CATALOG.find(operation => operation.status === 'DENIED_WITH_REASON');
    expect(denied).toBeDefined();
    expect(ids).not.toContain(denied!.operationId);
  });

  it('covers every tool and prompt the server registers by literal name', () => {
    const tools = [...serverSource.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map(m => m[1]);
    expect(tools.length).toBeGreaterThan(5);
    for (const tool of tools) expect(canonicalMcpCapabilityEntry(tool)).toBe(tool);
    const prompts = [...serverSource.matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(m => m[1]);
    expect(prompts.sort()).toEqual([...MCP_PROMPT_NAMES].sort());
  });

  it('marks curated tools, risk and approval from the catalog', () => {
    const search = MCP_CAPABILITIES.find(capability => capability.id === 'listIncidents');
    expect(search).toMatchObject({ tool: 'incident_search', curated: true, risk: 'R0' });
    const lead = MCP_CAPABILITIES.find(capability => capability.id === 'setTeamLead');
    expect(lead).toMatchObject({ curated: false, approval: true, risk: 'R2' });
    expect(MCP_CAPABILITY_DOMAINS).toEqual(
      expect.arrayContaining(['runbooks', 'incidents', 'mcp', 'approvals', 'prompts'])
    );
  });
});

describe('normalizeDisabledMcpCapabilities (save)', () => {
  it('canonicalises tool aliases, de-duplicates and sorts', () => {
    expect(
      normalizeDisabledMcpCapabilities(['incident_search', 'listIncidents', 'call_operation'])
    ).toEqual(['call_operation', 'listIncidents']);
  });

  it('keeps domain markers and drops explicit entries they already cover', () => {
    expect(
      normalizeDisabledMcpCapabilities([
        'runbook_find',
        'runbook_prepare_execution',
        'domain:runbooks',
        'getService',
      ])
    ).toEqual(['domain:runbooks', 'getService']);
  });

  it('rejects unknown ids, unknown domains and never-exposable operations', () => {
    for (const bad of ['notAnOperation', 'domain:nope', 'getChatOpsConfiguration', 'domain:'])
      expect(() => normalizeDisabledMcpCapabilities([bad])).toThrow(InvalidMcpCapabilityError);
    try {
      normalizeDisabledMcpCapabilities(['listIncidents', 'bogus']);
    } catch (error) {
      expect((error as InvalidMcpCapabilityError).entries).toEqual(['bogus']);
    }
  });

  it('does not resolve inherited object properties', () => {
    for (const bad of ['constructor', '__proto__', 'toString', 'domain:constructor'])
      expect(canonicalMcpCapabilityEntry(bad)).toBeNull();
  });
});

describe('resolveDisabledMcpCapabilities (read)', () => {
  it('ignores unknown entries and malformed values instead of failing', () => {
    expect(resolveDisabledMcpCapabilities(null).size).toBe(0);
    expect(resolveDisabledMcpCapabilities('listIncidents').size).toBe(0);
    const resolved = resolveDisabledMcpCapabilities(['removedOperation', 42, 'listIncidents']);
    expect([...resolved].sort()).toEqual(['incident_search', 'listIncidents']);
  });

  it('expands a domain to its operations, curated aliases and standalone tools', () => {
    const resolved = resolveDisabledMcpCapabilities(['domain:runbooks']);
    for (const name of [
      'listRunbooks',
      'runbook_find',
      'previewRunbookExecution',
      'runbook_preview',
      'runbook_prepare_execution',
      'runbook_execute_approved',
    ])
      expect(resolved.has(name)).toBe(true);
    expect(resolved.has('listIncidents')).toBe(false);
    const runbookOperations = MCP_CAPABILITIES.filter(
      capability => capability.domain === 'runbooks'
    );
    for (const capability of runbookOperations) expect(resolved.has(capability.id)).toBe(true);
  });

  it('answers by id or alias', () => {
    expect(isMcpCapabilityDisabled(['incident_search'], 'listIncidents')).toBe(true);
    expect(isMcpCapabilityDisabled(['listIncidents'], 'incident_search')).toBe(true);
    expect(isMcpCapabilityDisabled(['listIncidents'], 'getIncident')).toBe(false);
    expect(isMcpCapabilityDisabled(['domain:prompts'], 'investigate_incident')).toBe(true);
    expect(isMcpCapabilityDisabled([], 'listIncidents')).toBe(false);
  });
});

describe('registration filter', () => {
  it('skips disabled tools and prompts and passes others through', () => {
    const registerTool = vi.fn(() => 'tool-handle');
    const registerPrompt = vi.fn(() => 'prompt-handle');
    const server = { registerTool, registerPrompt } as unknown as McpServer;
    withholdDisabledRegistrations(server, new Set(['call_operation', 'summarize_shift']));
    const handle = server.registerTool('call_operation', {}, async () => ({ content: [] }));
    expect(handle).toMatchObject({ enabled: false });
    expect(registerTool).not.toHaveBeenCalled();
    expect(server.registerTool('search_capabilities', {}, async () => ({ content: [] }))).toBe(
      'tool-handle'
    );
    expect(registerTool).toHaveBeenCalledTimes(1);
    server.registerPrompt('summarize_shift', {}, async () => ({ messages: [] }));
    expect(registerPrompt).not.toHaveBeenCalled();
  });

  it('has an agent-facing explanation for a disabled capability', () => {
    expect(friendlyMcpError('MCP_CAPABILITY_DISABLED')).toMatchObject({ known: true });
  });
});
