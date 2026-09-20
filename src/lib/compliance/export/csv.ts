import type {
  ExportedControlSnapshot,
  ExportedEvidenceRecord,
  ExportedFrameworkRequirement,
} from './types';
import type { FrameworkControlMapping } from '../framework-mappings/types';

function escapeCsvField(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) {
    return '';
  }
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateControlsCsv(controls: readonly ExportedControlSnapshot[]): string {
  const header = [
    'control_id',
    'title',
    'assessment_mode',
    'owner',
    'runtime_status',
    'evaluated_at',
    'valid_until',
    'evidence_count',
  ].join(',');

  const rows = controls.map(c =>
    [
      escapeCsvField(c.controlId),
      escapeCsvField(c.title),
      escapeCsvField(c.assessmentMode),
      escapeCsvField(c.owner),
      escapeCsvField(c.resolvedCurrentState ?? 'UNVERIFIED'),
      escapeCsvField(c.evaluatedAt ?? ''),
      escapeCsvField(c.validUntil ?? ''),
      escapeCsvField(c.evidenceCount),
    ].join(',')
  );

  return [header, ...rows].join('\n') + '\n';
}

export function generateFrameworksCsv(
  requirements: readonly ExportedFrameworkRequirement[],
  mappings: readonly FrameworkControlMapping[]
): string {
  const header = [
    'framework',
    'requirement_id',
    'reference',
    'lifecycle',
    'control_id',
    'relationship',
    'evidence_expectation',
    'rationale',
    'notes',
  ].join(',');

  const rows: string[] = [];

  for (const req of requirements) {
    const reqMappings = mappings.filter(m => m.requirementId === req.requirementId);
    if (reqMappings.length === 0) {
      rows.push(
        [
          escapeCsvField(req.framework),
          escapeCsvField(req.requirementId),
          escapeCsvField(req.reference),
          escapeCsvField(req.lifecycle),
          '',
          '',
          '',
          '',
          '',
        ].join(',')
      );
    } else {
      for (const m of reqMappings) {
        rows.push(
          [
            escapeCsvField(req.framework),
            escapeCsvField(req.requirementId),
            escapeCsvField(req.reference),
            escapeCsvField(req.lifecycle),
            escapeCsvField(m.controlId),
            escapeCsvField(m.relationship),
            escapeCsvField(m.evidenceExpectation),
            escapeCsvField(m.rationale),
            escapeCsvField(m.notes ?? ''),
          ].join(',')
        );
      }
    }
  }

  return [header, ...rows].join('\n') + '\n';
}

export function generateEvidenceIndexCsv(evidence: readonly ExportedEvidenceRecord[]): string {
  const header = [
    'evidence_id',
    'control_id',
    'type',
    'collector_id',
    'collector_version',
    'observed_at',
    'content_hash',
    'integrity_valid',
  ].join(',');

  const rows = evidence.map(e =>
    [
      escapeCsvField(e.id),
      escapeCsvField(e.controlId),
      escapeCsvField(e.type),
      escapeCsvField(e.collectorId),
      escapeCsvField(e.collectorVersion),
      escapeCsvField(e.observedAt),
      escapeCsvField(e.contentHash),
      escapeCsvField(e.integrityValid ? 'VALID' : 'MISMATCH'),
    ].join(',')
  );

  return [header, ...rows].join('\n') + '\n';
}
