import { describe, expect, it } from 'vitest';
import {
  ASK_SQUIRE_CORE_TOOLS,
  ASK_SQUIRE_SCOPED_TOOLS,
  ASK_SQUIRE_SCOPES,
  ASK_SQUIRE_SENSITIVE_TOOLS,
  askSquireAllowedTools,
} from '@/lib/mcp/core/ask-squire-contract';
import { SQUIRE_TOOL_DATA_CLASS } from '@/lib/intelligence/squire/tools';
import { OBSERVABILITY_TOOL_NAMES } from '@/lib/intelligence/squire/tools-observability';

describe('ask_squire read-tool allowlist', () => {
  it('names only real Squire read tools', () => {
    const listed = [
      ...ASK_SQUIRE_CORE_TOOLS,
      ...Object.keys(ASK_SQUIRE_SCOPED_TOOLS),
      ...ASK_SQUIRE_SENSITIVE_TOOLS,
    ];
    for (const name of listed) expect(SQUIRE_TOOL_DATA_CLASS, name).toHaveProperty(name);
  });

  it('allows only the core tools for a connection with just the required scopes', () => {
    const allowed = askSquireAllowedTools(ASK_SQUIRE_SCOPES, { sensitiveReads: false });
    expect([...allowed].sort()).toEqual([...ASK_SQUIRE_CORE_TOOLS].sort());
    for (const name of [
      'find_people',
      'get_escalation_policy',
      'get_status_page',
      'get_slo_status',
    ])
      expect(allowed.has(name), name).toBe(false);
  });

  it('adds a scoped tool only with its scope, and sensitive tools only with sensitive reads', () => {
    const allowed = askSquireAllowedTools([...ASK_SQUIRE_SCOPES, 'users:read'], {
      sensitiveReads: true,
    });
    expect(allowed.has('find_people')).toBe(true);
    expect(allowed.has('get_status_page')).toBe(false);
    expect(allowed.has('get_alert_payload')).toBe(true);
    expect(allowed.has('search_knowledge')).toBe(true);
  });

  it('never allows observability connector tools, whatever the grant', () => {
    const everything = askSquireAllowedTools(
      [...ASK_SQUIRE_SCOPES, ...Object.values(ASK_SQUIRE_SCOPED_TOOLS), 'admin:manage'],
      { sensitiveReads: true }
    );
    for (const name of OBSERVABILITY_TOOL_NAMES) expect(everything.has(name), name).toBe(false);
  });

  it('classifies every Squire read tool: allowed by a list above or a connector tool', () => {
    const classified = new Set<string>([
      ...ASK_SQUIRE_CORE_TOOLS,
      ...Object.keys(ASK_SQUIRE_SCOPED_TOOLS),
      ...ASK_SQUIRE_SENSITIVE_TOOLS,
      ...OBSERVABILITY_TOOL_NAMES,
    ]);
    const unclassified = Object.keys(SQUIRE_TOOL_DATA_CLASS).filter(name => !classified.has(name));
    expect(unclassified).toEqual([]);
  });
});
