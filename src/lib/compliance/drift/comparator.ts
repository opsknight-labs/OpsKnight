import type { ComplianceObservation, ComplianceDetectedDrift, ObservationFinding } from './types';

/**
 * Compares two consecutive technical observations for a control and returns
 * all detected drift events or recoveries.
 *
 * This function is pure and deterministic.
 */
export function compareComplianceObservations(
  previous: ComplianceObservation,
  current: ComplianceObservation
): ComplianceDetectedDrift[] {
  const drifts: ComplianceDetectedDrift[] = [];

  const prevStatus = previous.status;
  const currStatus = current.status;

  // 1. Status regression / verification gap / recovery transitions
  if (currStatus === 'UNVERIFIED' && prevStatus !== 'UNVERIFIED') {
    drifts.push({
      kind: 'CONTROL_UNVERIFIED',
      impact: 'VERIFICATION_GAP',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Control runtime status transitioned from ${prevStatus} to UNVERIFIED (verification gap).`,
      details: {
        previousStatus: prevStatus,
        currentStatus: currStatus,
        reason: 'Verification gap observed during runtime evaluation',
      },
    });
  } else if (
    (prevStatus === 'IMPLEMENTED' &&
      (currStatus === 'PARTIAL' || currStatus === 'ACTION_REQUIRED')) ||
    (prevStatus === 'PARTIAL' && currStatus === 'ACTION_REQUIRED') ||
    (prevStatus === 'NOT_APPLICABLE' && currStatus === 'ACTION_REQUIRED')
  ) {
    drifts.push({
      kind: 'CONTROL_STATUS_REGRESSION',
      impact: 'ACTION_REQUIRED',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Control technical status regressed from ${prevStatus} to ${currStatus}.`,
      details: {
        previousStatus: prevStatus,
        currentStatus: currStatus,
        reason: 'Technical status regression detected',
      },
    });
  }

  // Check for recovery transitions
  if (prevStatus === 'UNVERIFIED' && currStatus !== 'UNVERIFIED') {
    drifts.push({
      kind: 'CONTROL_UNVERIFIED',
      impact: 'INFORMATIONAL',
      isRecovery: true,
      recoveryKind: 'CONTROL_UNVERIFIED',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Control recovered from UNVERIFIED to ${currStatus}.`,
      details: {
        previousStatus: prevStatus,
        currentStatus: currStatus,
      },
    });
  }

  if (
    (prevStatus === 'ACTION_REQUIRED' || prevStatus === 'PARTIAL') &&
    currStatus === 'IMPLEMENTED'
  ) {
    drifts.push({
      kind: 'CONTROL_STATUS_REGRESSION',
      impact: 'INFORMATIONAL',
      isRecovery: true,
      recoveryKind: 'CONTROL_STATUS_REGRESSION',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Control recovered technical status from ${prevStatus} to IMPLEMENTED.`,
      details: {
        previousStatus: prevStatus,
        currentStatus: currStatus,
      },
    });
  }

  // 2. Evaluator version change
  if (previous.evaluatorVersion !== current.evaluatorVersion) {
    drifts.push({
      kind: 'EVALUATOR_VERSION_CHANGED',
      impact: 'INFORMATIONAL',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Evaluator version updated from ${previous.evaluatorVersion} to ${current.evaluatorVersion}.`,
      details: {
        previousVersion: previous.evaluatorVersion,
        currentVersion: current.evaluatorVersion,
        evaluatorId: current.evaluatorId,
      },
    });
  }

  // 3. Evidence integrity mismatch
  const prevMismatches = previous.evidenceIntegrity.mismatches || 0;
  const currMismatches = current.evidenceIntegrity.mismatches || 0;

  if (currMismatches > 0 && currMismatches > prevMismatches) {
    drifts.push({
      kind: 'EVIDENCE_INTEGRITY_MISMATCH',
      impact: 'ACTION_REQUIRED',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Evidence canonical SHA-256 integrity mismatch detected (${currMismatches} record${currMismatches === 1 ? '' : 's'}).`,
      details: {
        totalEvidence: current.evidenceIntegrity.total,
        mismatches: currMismatches,
        previousMismatches: prevMismatches,
      },
    });
  } else if (prevMismatches > 0 && currMismatches === 0) {
    drifts.push({
      kind: 'EVIDENCE_INTEGRITY_MISMATCH',
      impact: 'INFORMATIONAL',
      isRecovery: true,
      recoveryKind: 'EVIDENCE_INTEGRITY_MISMATCH',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Evidence integrity verified without mismatches for current evaluation.`,
      details: {
        totalEvidence: current.evidenceIntegrity.total,
        mismatches: 0,
      },
    });
  }

  // 4. Finding set changes (stable codes)
  const prevFindingMap = new Map<string, string>(
    previous.findings.map((f: ObservationFinding) => [f.code, f.severity.toUpperCase()])
  );
  const currFindingMap = new Map<string, string>(
    current.findings.map((f: ObservationFinding) => [f.code, f.severity.toUpperCase()])
  );

  const added: Array<{ code: string; severity: string }> = [];
  const removed: Array<{ code: string; severity: string }> = [];
  const changedSeverity: Array<{
    code: string;
    previousSeverity: string;
    currentSeverity: string;
  }> = [];

  for (const [code, severity] of currFindingMap.entries()) {
    if (!prevFindingMap.has(code)) {
      added.push({ code, severity });
    } else {
      const prevSev = prevFindingMap.get(code)!;
      if (prevSev !== severity) {
        changedSeverity.push({ code, previousSeverity: prevSev, currentSeverity: severity });
      }
    }
  }

  for (const [code, severity] of prevFindingMap.entries()) {
    if (!currFindingMap.has(code)) {
      removed.push({ code, severity });
    }
  }

  if (added.length > 0 || removed.length > 0 || changedSeverity.length > 0) {
    const hasHighSeverity = added.some(
      f => f.severity === 'ERROR' || f.severity === 'CRITICAL' || f.severity === 'HIGH'
    );
    drifts.push({
      kind: 'FINDING_SET_CHANGED',
      impact: hasHighSeverity ? 'ACTION_REQUIRED' : 'INFORMATIONAL',
      previousStatus: prevStatus,
      currentStatus: currStatus,
      summary: `Observed finding set changed: ${added.length} added, ${removed.length} removed, ${changedSeverity.length} severity changed.`,
      details: {
        added,
        removed,
        changedSeverity,
      },
    });
  }

  return drifts;
}
