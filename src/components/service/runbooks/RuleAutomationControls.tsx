'use client';

import type { RunbookInput } from '@prisma/client';
import ResolveOnVerifiedRecoveryToggle from './ResolveOnVerifiedRecoveryToggle';
import MonitoringIncidentsToggle from './MonitoringIncidentsToggle';
import { ContextInputMappingEditor, ContextTargetMappingEditor } from './AutomationMappingEditors';
import UnattendedWritesPanel, {
  type UnattendedWriteAuthorization,
  type UnattendedWriteEligibility,
} from './UnattendedWritesPanel';
import type { AutomationContextSummary } from './context-helpers';
import type { ServiceRunbookAgent, ServiceRunbookAgentPool } from '../ServiceRunbooks';

/** Server-computed unattended-write details keyed by rule id (admin view only). */
export type ServiceRunbookUnattendedWriteDetails = Record<
  string,
  { eligibility: UnattendedWriteEligibility | null; authorizedAtLabel: string | null }
>;

type ContextInputMappingValue = Array<{ inputKey: string; contextKey: string }>;
type ContextTargetMappingValue = {
  contextKey?: string | null;
  entries?: Array<{ value: string | number | boolean; agentId?: string; agentPoolId?: string }>;
};

/**
 * Service Automation options for a rule form: monitoring opt-in, verified-recovery resolution and
 * the context input/target mappings. Field names match the server action contract.
 */
export function RuleAutomationFields({
  inputs,
  automationContext,
  agents,
  pools,
  defaults,
}: {
  inputs: Pick<RunbookInput, 'key' | 'label' | 'type' | 'required'>[];
  automationContext: AutomationContextSummary | null;
  agents: ServiceRunbookAgent[];
  pools: ServiceRunbookAgentPool[];
  defaults?: {
    resolveOnVerifiedRecovery: boolean;
    runOnMonitoringIncidents: boolean;
    contextInputMappings: unknown;
    contextTargetMappings: unknown;
  };
}) {
  const contextFields = automationContext?.fields ?? [];
  return (
    <div className="space-y-3">
      <ResolveOnVerifiedRecoveryToggle defaultChecked={defaults?.resolveOnVerifiedRecovery} />
      <MonitoringIncidentsToggle defaultChecked={defaults?.runOnMonitoringIncidents} />
      <ContextInputMappingEditor
        inputs={inputs}
        contextFields={contextFields}
        defaultValue={
          Array.isArray(defaults?.contextInputMappings)
            ? (defaults.contextInputMappings as ContextInputMappingValue)
            : []
        }
      />
      <ContextTargetMappingEditor
        contextFields={contextFields}
        agents={agents}
        pools={pools}
        defaultValue={(defaults?.contextTargetMappings ?? {}) as ContextTargetMappingValue}
      />
    </div>
  );
}

export function unattendedAuthorizationFor(
  rule: {
    unattendedWritesVersionId: string | null;
    unattendedWritesAuthorizedAt: Date | string | null;
    unattendedWritesAuthorizedBy?: { name: string | null } | null;
  },
  authorizedAtLabel: string | null
): UnattendedWriteAuthorization | null {
  if (!rule.unattendedWritesVersionId || !rule.unattendedWritesAuthorizedAt) return null;
  const authorizedAt = new Date(rule.unattendedWritesAuthorizedAt);
  return {
    versionId: rule.unattendedWritesVersionId,
    authorizedAtIso: authorizedAt.toISOString(),
    authorizedAtLabel:
      authorizedAtLabel ?? `${authorizedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    authorizedBy: rule.unattendedWritesAuthorizedBy?.name ?? null,
  };
}

/** Unattended-write review for an Automatic rule pinned to an exact version. */
export function RuleUnattendedWrites({
  serviceId,
  rule,
  details,
  canAuthorize,
}: {
  serviceId: string;
  rule: {
    id: string;
    mode: string;
    versionStrategy: string;
    runbookVersionId: string | null;
    runbook: { name: string };
    runbookVersion: { version: number } | null;
    unattendedWritesVersionId: string | null;
    unattendedWritesAuthorizedAt: Date | string | null;
    unattendedWritesAuthorizedBy?: { name: string | null } | null;
  };
  details: ServiceRunbookUnattendedWriteDetails[string] | undefined;
  canAuthorize: boolean;
}) {
  if (rule.mode !== 'AUTOMATIC' || rule.versionStrategy !== 'PINNED') return null;
  return (
    <UnattendedWritesPanel
      serviceId={serviceId}
      bindingId={rule.id}
      runbookName={rule.runbook.name}
      pinnedVersionId={rule.runbookVersionId}
      pinnedVersionNumber={rule.runbookVersion?.version ?? null}
      authorization={unattendedAuthorizationFor(rule, details?.authorizedAtLabel ?? null)}
      eligibility={details?.eligibility ?? null}
      canAuthorize={canAuthorize}
    />
  );
}
