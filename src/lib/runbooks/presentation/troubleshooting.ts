export interface RunbookTroubleshooting {
  category:
    | 'configuration'
    | 'policy'
    | 'infrastructure'
    | 'approval'
    | 'uncertain'
    | 'verification';
  title: string;
  action: string;
}

/** Stable guidance uses codes, never attempts to infer a safe retry from raw error text. */
export function runbookTroubleshooting(
  status: string,
  code?: string | null
): RunbookTroubleshooting | undefined {
  const errorCode = code ?? '';
  if (
    status === 'UNKNOWN' ||
    /UNKNOWN_OUTCOME|OUTCOME_UNKNOWN|WITH_UNKNOWN|TIMEOUT_UNKNOWN/.test(errorCode)
  )
    return {
      category: 'uncertain',
      title: 'The action may have completed',
      action:
        'Inspect the actual target and record the outcome before launching another write. Do not assume cancellation undid the action.',
    };
  if (/SECRET|GRANT/.test(errorCode))
    return {
      category: 'policy',
      title: 'Secret access is unavailable',
      action:
        'Ask an administrator to check the secret reference and current grants for this target. Keep credential values out of incident notes.',
    };
  if (/POLICY|DENIED|AUTHORITY_REVOKED/.test(errorCode))
    return {
      category: 'policy',
      title: 'Execution authority was rejected',
      action:
        'Review the selected target, local Agent policy and platform permissions. Changing a builder approval setting cannot override these checks.',
    };
  if (/INPUT|CONFIG|DEFINITION|PREVIEW_STALE/.test(errorCode))
    return {
      category: 'configuration',
      title: 'Configuration needs correction',
      action:
        'Validate the definition and typed inputs, publish the corrected draft, and preview the current target before executing.',
    };
  if (/VERIFICATION|PRECHECK/.test(errorCode))
    return {
      category: 'verification',
      title: 'A safety check failed',
      action:
        'Inspect the failed check and observed target state. A completed write does not prove recovery.',
    };
  if (status === 'WAITING_APPROVAL' || /APPROVAL/.test(errorCode))
    return {
      category: 'approval',
      title: 'Responder approval is required',
      action:
        'A responder with runbook approval permission must review and approve the exact plan. Expired plans need a new execution.',
    };
  if (status === 'TIMED_OUT' || /TIMEOUT|TIMED_OUT|LEASE_EXPIRED|EXECUTION_TIMEOUT/.test(errorCode))
    return {
      category: 'infrastructure',
      title: 'A deadline or lease expired',
      action:
        'Review the overall deadline, step timeout and Agent connectivity. Inspect any uncertain write outcome before retrying.',
    };
  if (
    status === 'WAITING_AGENT' ||
    /TARGET_NOT_FOUND|NO_ELIGIBLE|AGENT_UNAVAILABLE|CLAIM_TIMEOUT/.test(errorCode)
  )
    return {
      category: 'infrastructure',
      title: 'Waiting for an eligible Agent',
      action:
        'Check target identity, Agent heartbeat, effective capability and pool membership in Agents and Health. Preserve the target of machine-specific writes.',
    };
  if (status === 'FAILED')
    return {
      category: 'infrastructure',
      title: 'Execution failed',
      action:
        'Inspect the step and attempt timeline, bounded output and verification evidence. Confirm target state before retrying a mutation.',
    };
  return undefined;
}
