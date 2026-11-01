import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable, isMcpSensitiveRead } from '.';

/**
 * Administrator capability controls.
 *
 * A capability is anything an assistant can reach through MCP:
 * - a catalog operation, identified by its operationId. Its curated tool (for example
 *   `incident_search` for `listIncidents`) is only an alias: disabling either name disables the
 *   operation on every surface (curated tool, search, describe, call_operation, execute_plan,
 *   approvals, resources and subscriptions);
 * - a standalone tool that is not a catalog operation (composite reads, approval workflow tools
 *   and the generic discovery/invocation tools), identified by its tool name;
 * - a prompt, identified by its prompt name.
 *
 * `McpPolicy.disabledCapabilities` stores explicit ids plus optional `domain:<name>` markers.
 * A domain marker is kept as a marker (not expanded on save) so an operation added to that domain
 * later is disabled too: the administrator's intent "no runbooks over MCP" stays fail-closed.
 * Unknown entries are ignored on read, so a catalog change can never turn a stored list into an
 * error that takes MCP down; they are rejected on save.
 */

export type McpCapabilityKind = 'operation' | 'tool' | 'prompt';
export type McpRisk = 'R0' | 'R1' | 'R2' | 'R3';

export interface McpCapability {
  id: string;
  kind: McpCapabilityKind;
  domain: string;
  risk: McpRisk;
  /** Curated tool name for catalog operations that have one, or the tool/prompt name itself. */
  tool: string | null;
  /** True for curated (named, purpose-built) tools; false for operations reachable only generically. */
  curated: boolean;
  approval: boolean;
  /** Reads change nothing; R1 to R3 operations that are not reads change state. */
  read: boolean;
  summary: string;
}

export const MCP_DOMAIN_PREFIX = 'domain:';
/** Generous ceiling: one entry per capability plus every domain marker. */
export const MAX_DISABLED_CAPABILITY_ENTRIES = 1024;

/** Tools registered by the MCP server that are not catalog operations. */
const STANDALONE_TOOLS: readonly Omit<McpCapability, 'kind' | 'curated' | 'tool' | 'read'>[] = [
  {
    id: 'search_capabilities',
    domain: 'mcp',
    risk: 'R0',
    approval: false,
    summary: 'Find authorized operations in the catalog.',
  },
  {
    id: 'describe_operation',
    domain: 'mcp',
    risk: 'R0',
    approval: false,
    summary: 'Return the schema and safeguards of one operation.',
  },
  {
    id: 'call_operation',
    domain: 'mcp',
    risk: 'R1',
    approval: false,
    summary: 'Invoke any enabled operation by its operationId.',
  },
  {
    id: 'execute_plan',
    domain: 'mcp',
    risk: 'R0',
    approval: false,
    summary: 'Run up to eight enabled reads as one plan.',
  },
  {
    id: 'operation_prepare',
    domain: 'approvals',
    risk: 'R2',
    approval: true,
    summary: 'Freeze a sensitive change for independent approval.',
  },
  {
    id: 'operation_get_approval',
    domain: 'approvals',
    risk: 'R0',
    approval: false,
    summary: 'Read the status of an approval the assistant requested.',
  },
  {
    id: 'operation_commit_approved',
    domain: 'approvals',
    risk: 'R2',
    approval: true,
    summary: 'Apply a change after a different administrator approved it.',
  },
  {
    id: 'runbook_prepare_execution',
    domain: 'runbooks',
    risk: 'R2',
    approval: true,
    summary: 'Freeze a runbook execution plan for independent approval.',
  },
  {
    id: 'runbook_execute_approved',
    domain: 'runbooks',
    risk: 'R3',
    approval: true,
    summary: 'Execute an independently approved runbook plan.',
  },
  {
    id: 'incident_get_context',
    domain: 'incidents',
    risk: 'R0',
    approval: false,
    summary: 'Read an incident with its timeline and related incidents.',
  },
  {
    id: 'postmortem_get_context',
    domain: 'postmortems',
    risk: 'R0',
    approval: false,
    summary: 'Read a postmortem with action items, contributors and history.',
  },
];

/** Prompts registered by the MCP server; a test pins this list to the server's registrations. */
export const MCP_PROMPT_NAMES = [
  'investigate_incident',
  'summarize_shift',
  'explain_escalation',
  'prepare_postmortem',
  'review_automation_rule',
  'preview_remediation',
] as const;

const PROMPT_DOMAIN = 'prompts';

/** Only operations MCP can ever expose; denied and unsupported operations are never listed. */
const manageableOperations = MCP_CATALOG.filter(
  operation => isMcpExecutable(operation) || isMcpApprovalGated(operation)
);

export const MCP_CAPABILITIES: readonly McpCapability[] = [
  ...manageableOperations.map((operation): McpCapability => ({
    id: operation.operationId,
    kind: 'operation',
    domain: operation.domain,
    risk: operation.risk as McpRisk,
    tool: operation.tool ?? null,
    curated: Boolean(operation.tool),
    approval: isMcpApprovalGated(operation),
    read: operation.risk === 'R0' || isMcpSensitiveRead(operation),
    summary: `${operation.method.toUpperCase()} ${operation.path}`,
  })),
  ...STANDALONE_TOOLS.map((tool): McpCapability => ({
    ...tool,
    kind: 'tool',
    tool: tool.id,
    curated: true,
    read: tool.risk === 'R0',
  })),
  ...MCP_PROMPT_NAMES.map((name): McpCapability => ({
    id: name,
    kind: 'prompt',
    domain: PROMPT_DOMAIN,
    risk: 'R0',
    tool: name,
    curated: true,
    approval: false,
    read: true,
    summary: 'Guidance prompt. Grants no authority by itself.',
  })),
];

const capabilityById = new Map(MCP_CAPABILITIES.map(capability => [capability.id, capability]));
/** Curated tool name to operationId, for operations that have a curated tool. */
const toolAliases = new Map(
  manageableOperations
    .filter(operation => operation.tool)
    .map(operation => [operation.tool as string, operation.operationId])
);
const domainMembers = new Map<string, string[]>();
for (const capability of MCP_CAPABILITIES) {
  const members = domainMembers.get(capability.domain) ?? [];
  members.push(capability.id);
  domainMembers.set(capability.domain, members);
}

export const MCP_CAPABILITY_DOMAINS: readonly string[] = [...domainMembers.keys()].sort();

/** Canonical id for an entry, or null when it names nothing that exists. */
export function canonicalMcpCapabilityEntry(entry: string): string | null {
  if (entry.startsWith(MCP_DOMAIN_PREFIX))
    return domainMembers.has(entry.slice(MCP_DOMAIN_PREFIX.length)) ? entry : null;
  if (capabilityById.has(entry)) return entry;
  return toolAliases.get(entry) ?? null;
}

export class InvalidMcpCapabilityError extends Error {
  constructor(public readonly entries: string[]) {
    super('MCP_INVALID_CAPABILITY');
  }
}

/**
 * Save-time normalisation: every entry must be a real capability, curated tool alias or domain.
 * Aliases become operationIds, duplicates and entries covered by a domain marker are removed,
 * and the result is sorted so the stored value and audit diff are stable.
 */
export function normalizeDisabledMcpCapabilities(entries: readonly string[]): string[] {
  const unknown = entries.filter(entry => canonicalMcpCapabilityEntry(entry) === null);
  if (unknown.length) throw new InvalidMcpCapabilityError(unknown.slice(0, 10));
  const canonical = new Set(entries.map(entry => canonicalMcpCapabilityEntry(entry) as string));
  const domains = new Set(
    [...canonical]
      .filter(entry => entry.startsWith(MCP_DOMAIN_PREFIX))
      .map(entry => entry.slice(MCP_DOMAIN_PREFIX.length))
  );
  return [...canonical]
    .filter(
      entry =>
        entry.startsWith(MCP_DOMAIN_PREFIX) || !domains.has(capabilityById.get(entry)!.domain)
    )
    .sort();
}

/**
 * Read-time expansion to the set of disabled names: capability ids plus the curated tool name of
 * every disabled operation, so either name can be checked. Never throws: unknown or stale entries
 * are ignored, and anything that is not an array of strings disables nothing.
 */
export function resolveDisabledMcpCapabilities(entries: unknown): ReadonlySet<string> {
  const disabled = new Set<string>();
  if (!Array.isArray(entries)) return disabled;
  const add = (id: string) => {
    disabled.add(id);
    const tool = capabilityById.get(id)?.tool;
    if (tool) disabled.add(tool);
  };
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const canonical = canonicalMcpCapabilityEntry(entry);
    if (!canonical) continue;
    if (canonical.startsWith(MCP_DOMAIN_PREFIX))
      for (const id of domainMembers.get(canonical.slice(MCP_DOMAIN_PREFIX.length)) ?? []) add(id);
    else add(canonical);
  }
  return disabled;
}

/** True when the capability (by id or curated tool name) is disabled by the stored entries. */
export function isMcpCapabilityDisabled(entries: unknown, ...ids: string[]) {
  const disabled = resolveDisabledMcpCapabilities(entries);
  return ids.some(id => disabled.has(id));
}
