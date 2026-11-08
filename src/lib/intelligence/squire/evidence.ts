import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { sha256 } from '../ai/digest';
import type { AiDataClass } from '../ai/port';
import type { SourceReference } from '../conversations/contract';
import type { SquireCitation } from './contract';
import { readSourceStates, sourceKey, type SourceIdentity } from './evidence-access';
import type { IncidentBriefing } from './prompt';

export type EvidenceSnapshot = SourceIdentity & { data: unknown; label?: string };
type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(row) : []);
const unavailable = { error: 'Evidence could not be verified. Read the source again.' };
const prefixes = new Map<SourceReference['kind'], string>([
  ['incident', '/incidents/'],
  ['runbook', '/runbooks/'],
  ['change', '/changes/'],
  ['alert', '/alerts/'],
  ['service', '/services/'],
  ['schedule', '/schedules/'],
  ['postmortem', '/postmortems/'],
]);

/** Turn-local provenance. Handles are minted only after an actual read and a current visibility check. */
export class SquireEvidenceRegistry {
  private readonly captured = new Map<string, { source: SourceReference; label: string }>();
  private complete = true;
  private readonly coverageNotices = new Set<string>();
  notices(): string[] {
    return [...this.coverageNotices];
  }
  constructor(
    private readonly actor: AuthorizationActor,
    private readonly dataClass: AiDataClass
  ) {}

  get verified(): boolean {
    return this.complete && this.captured.size > 0;
  }
  sources(): SourceReference[] {
    return [...this.captured.values()].map(value => value.source);
  }

  async capture(snapshots: EvidenceSnapshot[]): Promise<SourceReference[] | null> {
    const unique = [...new Map(snapshots.map(source => [sourceKey(source), source])).values()];
    const additional = unique.filter(source => !this.captured.has(sourceKey(source)));
    if (this.captured.size + additional.length > 32) {
      this.complete = false;
      return null;
    }
    const states = await readSourceStates(this.actor, unique);
    if (unique.some(source => !states.has(sourceKey(source)))) {
      this.complete = false;
      return null;
    }
    const observedAt = new Date().toISOString();
    const result: SourceReference[] = [];
    for (const snapshot of unique) {
      const version = sha256(JSON.stringify(snapshot.data));
      const existing = this.captured.get(sourceKey(snapshot));
      // Different views of the same source can have different snapshot digests.
      // Only a real revision change establishes that the underlying source changed.
      const rawUpdatedAt = row(snapshot.data).updatedAt;
      const updatedAt = rawUpdatedAt instanceof Date ? rawUpdatedAt.toISOString() : rawUpdatedAt;
      const sourceUpdatedAt =
        typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt))
          ? new Date(updatedAt).toISOString()
          : existing?.source.sourceUpdatedAt;
      if (
        existing?.source.sourceUpdatedAt &&
        sourceUpdatedAt &&
        existing.source.sourceUpdatedAt !== sourceUpdatedAt
      )
        this.complete = false;
      const source: SourceReference = {
        kind: snapshot.kind,
        id: snapshot.id,
        handle: existing?.source.handle ?? randomUUID(),
        observedAt,
        version,
        dataClass: this.dataClass,
        ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      };
      this.captured.set(sourceKey(snapshot), {
        source,
        label: (snapshot.label ?? snapshot.id).slice(0, 200),
      });
      result.push(source);
    }
    return result;
  }

  async briefing(briefing: IncidentBriefing): Promise<IncidentBriefing | null> {
    const snapshots: EvidenceSnapshot[] = [
      {
        kind: 'incident',
        id: briefing.incident.id,
        label: briefing.incident.title,
        data: { ...briefing, updatedAt: briefing.incident.updatedAt },
      },
      ...briefing.similar.map(data => ({
        kind: 'incident' as const,
        id: data.id,
        label: data.title,
        data,
      })),
      ...briefing.runbooks.map(data => ({
        kind: 'runbook' as const,
        id: data.id,
        label: data.name,
        data,
      })),
      ...briefing.changes.flatMap(data =>
        data.id ? [{ kind: 'change' as const, id: data.id, label: data.summary, data }] : []
      ),
    ];
    if (briefing.changes.some(change => !change.id)) this.complete = false;
    return (await this.capture(snapshots)) ? briefing : null;
  }

  async observe(name: string, input: unknown, result: unknown): Promise<unknown> {
    if (Buffer.byteLength(JSON.stringify(result) ?? '', 'utf8') > 32_768) {
      this.complete = false;
      return unavailable;
    }
    const object = row(result);
    if (name === 'semantic_search_incidents') {
      const coverage = row(object.coverage);
      if (coverage.mode === 'BOUNDED_EXACT')
        this.coverageNotices.add(
          'Semantic search used a bounded scan of recent visible embeddings. Older matches may be missing.'
        );
      else if (coverage.mode === 'ANN')
        this.coverageNotices.add(
          'Semantic search is approximate; some matching incidents may be missing.'
        );
      else if (coverage.mode === 'UNAVAILABLE')
        this.coverageNotices.add(
          'Semantic search is unavailable. This does not establish that there are no matching incidents.'
        );
    }
    if (object.error) return result;
    const snapshots: EvidenceSnapshot[] = [];
    const add = (kind: SourceReference['kind'], data: Row, field = 'id') => {
      const id =
        field === 'personId'
          ? data.personId
          : field === 'scheduleId'
            ? data.scheduleId
            : field === 'incidentId'
              ? data.incidentId
              : data.id;
      if (typeof id !== 'string' || !id || id.length > 64) {
        this.complete = false;
        return;
      }
      snapshots.push({
        kind,
        id,
        data,
        label: String(data.title ?? data.name ?? data.summary ?? id),
      });
    };
    const subject = (kind: SourceReference['kind']) =>
      add(kind, { ...object, id: row(input).id, snapshot: result });
    switch (name) {
      case 'semantic_search_incidents':
        rows(object.items ?? result).forEach(data => add('incident', data));
        break;
      case 'search_incidents':
        rows(result).forEach(data => add('incident', data));
        break;
      case 'get_incident':
        add('incident', object);
        break;
      case 'get_runbook':
        add('runbook', object);
        break;
      case 'get_recent_changes':
        rows(result).forEach(data => add('change', data));
        break;
      case 'get_timeline':
        subject('incident');
        break;
      case 'list_alerts':
        subject('incident');
        rows(result).forEach(data => add('alert', data));
        break;
      case 'get_intelligence':
        subject('incident');
        [
          ...rows(object.similarIncidents),
          ...rows(object.relatedIncidents),
          ...rows(object.upstreamIncidents),
        ].forEach(data => add('incident', data));
        rows(object.possibleChanges).forEach(data => add('change', data));
        rows(object.runbooks).forEach(data => add('runbook', data));
        break;
      case 'get_service':
        add('service', object);
        rows(object.dependencySources).forEach(data => add('service', data));
        rows(object.openIncidents).forEach(data => add('incident', data));
        rows(object.changesLast24h).forEach(data => add('change', data));
        break;
      case 'search_postmortems':
        rows(result).forEach(data => add('postmortem', data, 'incidentId'));
        break;
      case 'who_is_on_call':
        rows(result).forEach(data => add('schedule', data, 'scheduleId'));
        if (typeof row(input).incidentId === 'string')
          add('incident', { id: row(input).incidentId });
        break;
      case 'find_people':
        rows(result).forEach(data => add('person', data, 'personId'));
        break;
      case 'get_status_page':
        add('status_page', object);
        rows(object.services).forEach(data => add('service', data));
        break;
      case 'get_problem_outcomes':
        subject('incident');
        if (object.bestRunbook) add('runbook', row(object.bestRunbook));
        break;
      // Observability connectors (slice F1): the source is the connection that was queried, re-checked for
      // this person on replay; a diff also cites the recorded change it was read for.
      case 'query_metrics':
      case 'search_logs':
      case 'get_traces':
      case 'get_error_events':
      case 'get_change_diff':
        add('observability', {
          id: object.connectionId,
          name: object.connectionName,
          snapshot: result,
        });
        if (name === 'get_change_diff') add('change', { id: object.changeId, title: object.title });
        break;
      default:
        this.complete = false;
        return unavailable;
    }
    const evidence = await this.capture(snapshots);
    return evidence ? { data: result, evidence } : unavailable;
  }

  /** A readable but unretrieved URL never becomes a citation. */
  citations(text: string): SquireCitation[] {
    return [...this.captured.values()]
      .flatMap(({ source, label }) => {
        if (
          source.kind !== 'incident' &&
          source.kind !== 'runbook' &&
          source.kind !== 'change' &&
          source.kind !== 'alert' &&
          source.kind !== 'service' &&
          source.kind !== 'schedule' &&
          source.kind !== 'postmortem'
        )
          return [];
        const kind = source.kind;
        const href = `${prefixes.get(kind)}${encodeURIComponent(source.id)}`;
        // Require an exact URL boundary, so a short id cannot cite a different longer id.
        const referenced =
          text.includes(`[evidence:${source.handle}]`) ||
          [
            ...text.matchAll(
              /\/(?:incidents|runbooks|changes|alerts|services|schedules|postmortems)\/[A-Za-z0-9_-]{1,64}(?![A-Za-z0-9_-])/g
            ),
          ].some(match => match[0] === href);
        return referenced
          ? [
              {
                kind,
                id: source.id,
                label,
                href,
                handle: source.handle,
                observedAt: source.observedAt,
                version: source.version,
                why: 'Read during this answer; relevance is an interpretation.',
              },
            ]
          : [];
      })
      .slice(0, 8);
  }
}
