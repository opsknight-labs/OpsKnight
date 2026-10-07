/* eslint-disable security/detect-object-injection -- Array indices come from local map callbacks or bounds-checked rule ordering. */
'use client';
import { ActionEditor } from './ActionEditor';
import { AutomationReviewDialog } from './AutomationReviewDialog';
import { AliasEditor } from './AliasEditor';
import { TypedValueInput } from './TypedValueInput';
import { compareSnapshots } from '@/lib/automation/diff';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getAutomationArea, automationAction } from '@/app/(app)/services/[id]/automation/actions';
import {
  builtinFields,
  emptySnapshot,
  snapshotSchema,
  type Snapshot,
  type Rule,
  type Condition,
  type Field,
} from '@/lib/automation/contract';
import { compileAutomation } from '@/lib/automation/compiler';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import type { testAutomation } from '@/lib/automation/testing';
import type { Observation } from '@/lib/automation/discovery';
import { ArrowUp, ArrowDown, Plus, Trash2, Workflow } from 'lucide-react';
type Area = 'overview' | 'context' | 'rules' | 'test' | 'activity';
type Data = Awaited<ReturnType<typeof getAutomationArea>>;
type TestResult = Awaited<ReturnType<typeof testAutomation>>;
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
const formatState = (state: unknown) => {
  if (!state || typeof state !== 'object') return 'Missing';
  const value = state as { state?: string; value?: unknown; raw?: unknown };
  return value.state === 'RECOGNIZED'
    ? String(value.value)
    : value.state === 'UNMAPPED'
      ? `${String(value.raw)} (unmapped)`
      : 'Missing';
};
const defaultSample = JSON.stringify(
  {
    event_action: 'trigger',
    dedup_key: 'sample',
    payload: {
      summary: 'Example alert',
      source: 'sample',
      severity: 'error',
      custom_details: { environment: 'prd' },
    },
  },
  null,
  2
);
function newRule(phase: Rule['phase']): Rule {
  return {
    id: crypto.randomUUID(),
    name: 'New rule',
    phase,
    enabled: true,
    conditions: [],
    actions:
      phase === 'ENRICH'
        ? [{ type: 'SET_PRIORITY', value: 'P1' }]
        : [{ type: 'USE_SERVICE_DEFAULT' }],
  };
}
export default function AutomationWorkspace({ serviceId }: { serviceId: string }) {
  const [review, setReview] = useState<'publish' | 'LIVE' | null>(null);
  const [ruleSearch, setRuleSearch] = useState('');
  const [contextSearch, setContextSearch] = useState('');
  const [ruleStateFilter, setRuleStateFilter] = useState('all');
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
  const [activityPage, setActivityPage] = useState(1);
  const [area, setArea] = useState<Area>('overview');
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Snapshot>(emptySnapshot);
  const revision = useRef(0),
    initialized = useRef(false),
    saving = useRef<Promise<boolean> | null>(null),
    persistedGeneration = useRef(0),
    generation = useRef(0);
  const [saveState, setSaveState] = useState('Saved');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(defaultSample);
  const [providerSample, setProviderSample] = useState('{"environment":"prd"}');
  const [integrationType, setIntegrationType] = useState('EVENTS_API');
  const [integrationId, setIntegrationId] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [discoveries, setDiscoveries] = useState<
    Array<Observation & { source?: 'EVENT' | 'PROVIDER'; frequency?: number; examples?: string[] }>
  >([]);
  const [fieldLabel, setFieldLabel] = useState('Environment');
  const [fieldType, setFieldType] = useState<Field['type']>('ENUM');
  const [observedPath, setObservedPath] = useState('');
  const [values, setValues] = useState('production, staging, development');
  const [advanced, setAdvanced] = useState(false);
  const draggedRule = useRef<string | null>(null);
  const [traceFilter, setTraceFilter] = useState('ALL');
  const [conflictDraft, setConflictDraft] = useState<{
    snapshot: Snapshot;
    revision: number;
  } | null>(null);
  const [versionView, setVersionView] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [localCopy, setLocalCopy] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const load = useCallback(
    async (nextArea: Area) => {
      setError('');
      try {
        const next = await getAutomationArea(serviceId, nextArea, activityPage);
        setData(next);
        if (!initialized.current) revision.current = next.draft.revision;
        if (!initialized.current && ['context', 'rules', 'test'].includes(nextArea)) {
          const parsed = snapshotSchema.safeParse(next.draft.snapshot);
          setDraft(parsed.success ? parsed.data : emptySnapshot);
          revision.current = next.draft.revision;
          initialized.current = true;
        }
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load automation');
      }
    },
    [serviceId, activityPage]
  );
  useEffect(() => {
    void load(area);
  }, [area, load]);
  const edit = (next: Snapshot) => {
    generation.current++;
    initialized.current = true;
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setSaveState('Unsaved');
  };
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (conflict || !initialized.current) return false;
    const work = (async () => {
      setSaveState('Saving…');
      const savedGeneration = generation.current;
      try {
        const response = await automationAction({
          action: 'save',
          serviceId,
          snapshot: draftRef.current,
          expectedRevision: revision.current,
        });
        if (!response.ok) {
          setConflict(!!response.conflict);
          setSaveState(
            response.conflict
              ? 'Conflict detected'
              : navigator.onLine
                ? 'Save failed — retry'
                : 'Offline'
          );
          setError(response.error);
          return false;
        }
        revision.current = (response.data as { revision: number }).revision;
        persistedGeneration.current = savedGeneration;
        if (savedGeneration === generation.current) {
          setDirty(false);
          setSaveState('Saved');
          setLocalCopy(null);
          try {
            localStorage.removeItem(`automation-draft:${serviceId}`);
          } catch {
            /* Optional browser recovery. */
          }
        } else setSaveState('Unsaved');
        return true;
      } catch (err) {
        setSaveState(navigator.onLine ? 'Save failed — retry' : 'Offline');
        setError(err instanceof Error ? err.message : 'Save failed');
        return false;
      }
    })();
    saving.current = work;
    try {
      return await work;
    } finally {
      if (saving.current === work) saving.current = null;
    }
  }, [serviceId, conflict]);
  useEffect(() => {
    if (
      !dirty ||
      conflict ||
      !data?.canEdit ||
      saveState === 'Offline' ||
      saveState.startsWith('Save failed')
    )
      return;
    const timer = setTimeout(() => {
      void save();
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, dirty, conflict, data?.canEdit, save, saveState]);
  useEffect(() => {
    if (!initialized.current || !dirty) return;
    try {
      localStorage.setItem(`automation-draft:${serviceId}`, JSON.stringify(draft));
    } catch {
      /* Browser storage may be unavailable; in-memory edits remain available. */
    }
  }, [draft, dirty, serviceId]);
  useEffect(() => {
    try {
      setLocalCopy(localStorage.getItem(`automation-draft:${serviceId}`));
    } catch {
      /* Optional recovery copy. */
    }
  }, [serviceId]);
  const command = async (input: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      if (saving.current && !(await saving.current)) return false;
      while (initialized.current && persistedGeneration.current < generation.current) {
        if (!(await save())) return false;
      }
      if (conflict) {
        setError('Resolve the draft conflict before continuing.');
        return false;
      }
      const response = await automationAction({
        ...input,
        serviceId,
        expectedActiveVersionId: data?.activeVersionId ?? null,
        ...(input.action === 'publish' ? { expectedRevision: revision.current } : {}),
      });
      if (!response.ok) {
        setError(response.error);
        return false;
      }
      await load(area);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Automation request failed');
      return false;
    } finally {
      setBusy(false);
    }
  };
  let issues: ReturnType<typeof compileAutomation>['issues'] = [];
  try {
    issues = compileAutomation(draft).issues;
  } catch (err) {
    issues = [
      {
        level: 'ERROR',
        code: 'INVALID_DRAFT',
        message: err instanceof Error ? err.message : 'Invalid draft',
      },
    ];
  }
  const fields = [...builtinFields, ...draft.fields];
  const updateRule = (id: string, update: Partial<Rule>) =>
    edit({ ...draft, rules: draft.rules.map(r => (r.id === id ? { ...r, ...update } : r)) });
  const updateField = (key: string, update: Partial<Field>) =>
    edit({ ...draft, fields: draft.fields.map(f => (f.key === key ? { ...f, ...update } : f)) });
  const move = (index: number, direction: number) => {
    const rules = [...draft.rules],
      target = index + direction;
    if (target < 0 || target >= rules.length || rules[index].phase !== rules[target].phase) return;
    [rules[index], rules[target]] = [rules[target], rules[index]];
    edit({ ...draft, rules });
  };
  const createTemplate = (kind: string) => {
    const env: Field = {
      fieldId: crypto.randomUUID(),
      key: 'environment',
      label: 'Environment',
      type: 'ENUM',
      caseSensitive: false,
      allowedValues: ['production', 'staging', 'development'],
      aliases: { prod: 'production', prd: 'production', stg: 'staging' },
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
    };
    const enterprise: Field = {
      fieldId: crypto.randomUUID(),
      key: kind === 'account' ? 'aws_account' : 'customer_tier',
      label: kind === 'account' ? 'AWS Account ID' : 'Customer tier',
      type: 'STRING',
      caseSensitive: false,
      aliases: {},
      mappings: [
        { source: 'PROVIDER', path: kind === 'account' ? 'AWSAccountId' : 'customer_tier' },
      ],
    };
    const field = kind === 'account' || kind === 'vip' ? enterprise : env;
    const condition: Condition =
      kind === 'priority'
        ? { fieldKey: 'priority', operator: 'IN', value: ['P1', 'P2'] }
        : {
            fieldKey: field.key,
            operator: 'EQ',
            value:
              kind === 'account' ? '123456789012' : kind === 'vip' ? 'enterprise' : 'production',
          };
    edit({
      schemaVersion: 1,
      fields: kind === 'priority' ? [] : [field],
      rules:
        kind === 'scratch'
          ? []
          : [
              {
                ...newRule('ROUTE'),
                name:
                  kind === 'priority'
                    ? 'High priority'
                    : kind === 'vip'
                      ? 'Enterprise customer'
                      : kind === 'account'
                        ? 'AWS account'
                        : 'Production alerts',
                conditions: [condition],
              },
            ],
    });
    setArea('rules');
  };
  const analyze = async () => {
    try {
      const response = await automationAction({
        action: 'discover',
        serviceId,
        sample: JSON.parse(providerSample),
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setDiscoveries(response.data as Observation[]);
    } catch {
      setError('Enter a valid JSON provider sample');
    }
  };
  const addField = () => {
    const key = fieldLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || fields.some(f => f.key === key) || !observedPath) {
      setError('Choose a unique field name and an observed source field');
      return;
    }
    edit({
      ...draft,
      fields: [
        ...draft.fields,
        {
          fieldId: crypto.randomUUID(),
          key,
          label: fieldLabel.trim(),
          type: fieldType,
          caseSensitive: false,
          ...(fieldType === 'ENUM'
            ? {
                allowedValues: values
                  .split(',')
                  .map(v => v.trim())
                  .filter(Boolean),
              }
            : {}),
          aliases: {},
          mappings: [
            {
              source: discoveries.find(item => item.path === observedPath)?.source ?? 'PROVIDER',
              integrationType:
                discoveries.find(item => item.path === observedPath)?.source === 'EVENT' ||
                integrationType === 'ALL'
                  ? undefined
                  : integrationType,
              path: observedPath,
            },
          ],
        },
      ],
    });
  };
  const runTest = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await automationAction({
        action: 'test',
        serviceId,
        snapshot: draft,
        event: JSON.parse(sample),
        providerPayload: JSON.parse(providerSample),
        integrationType,
        ...(integrationId ? { integrationId } : {}),
      });
      if (!response.ok) setError(response.error);
      else setResult(response.data as TestResult);
    } catch {
      setError('Enter valid event and provider JSON');
    } finally {
      setBusy(false);
    }
  };
  const counts = data?.aggregates.reduce(
    (sum, row) => ({
      evaluated: sum.evaluated + row.evaluated,
      same: sum.same + row.same,
      routes: sum.routes + row.routeDifferent,
      priorities: sum.priorities + row.priorityDifferent,
      skips: sum.skips + row.noEscalationDifferent,
      errors: sum.errors + row.errors,
    }),
    { evaluated: 0, same: 0, routes: 0, priorities: 0, skips: 0, errors: 0 }
  );
  return (
    <section aria-label="Service automation" className="space-y-5">
      <AutomationReviewDialog
        action={review}
        snapshot={
          review === 'LIVE' && data?.activeVersion
            ? snapshotSchema.parse(data.activeVersion.snapshot)
            : draft
        }
        version={data?.activeVersion?.versionNumber ?? null}
        enabled={data?.enabled ?? false}
        counts={counts}
        busy={busy}
        error={error}
        onCancel={() => setReview(null)}
        onConfirm={() => {
          void command(
            review === 'LIVE' ? { action: 'mode', mode: 'LIVE' } : { action: 'publish' }
          ).then(success => {
            if (success) setReview(null);
          });
        }}
      />
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Automation <Badge>{data?.mode ?? 'Loading…'}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              Version {data?.activeVersion?.versionNumber ?? '—'} · {saveState}
            </p>
          </div>
          {data?.canPublish && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || conflict || issues.some(i => i.level === 'ERROR')}
                onClick={() => {
                  void (async () => {
                    if (!initialized.current && !(await load('rules'))) return;
                    setReview('publish');
                  })();
                }}
              >
                Publish
              </Button>
              <select
                aria-label="Automation mode"
                className={controlClass}
                value={data.mode}
                disabled={busy}
                onChange={e => {
                  if (e.target.value === 'LIVE') {
                    setBusy(true);
                    void load('rules')
                      .then(loaded => {
                        if (loaded) setReview('LIVE');
                      })
                      .finally(() => setBusy(false));
                  } else void command({ action: 'mode', mode: e.target.value });
                }}
              >
                <option>DISABLED</option>
                <option>SHADOW</option>
                <option>LIVE</option>
              </select>
            </div>
          )}
        </div>
        {data && !data.enabled && (
          <p className="rounded-lg border bg-muted p-3 text-sm">
            Automation is globally disabled. An administrator can enable it in Settings → System →
            Automation. Drafts and sample tests remain available.
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive p-3 text-sm text-destructive"
          >
            {error}{' '}
            {saveState.includes('failed') && (
              <Button size="sm" variant="outline" onClick={() => void save()}>
                Retry save
              </Button>
            )}
          </div>
        )}
        {conflict && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                const remote = await getAutomationArea(serviceId, 'rules');
                setConflictDraft({
                  snapshot: snapshotSchema.parse(remote.draft.snapshot),
                  revision: remote.draft.revision,
                });
              }}
            >
              Review conflict
            </Button>
            {conflictDraft && (
              <div className="w-full space-y-2">
                {compareSnapshots(conflictDraft.snapshot, draft).map((change, index) => (
                  <p key={index} className="text-sm">
                    {change}
                  </p>
                ))}
                <Button
                  onClick={async () => {
                    const response = await automationAction({
                      action: 'save',
                      serviceId,
                      snapshot: draft,
                      expectedRevision: conflictDraft.revision,
                    });
                    if (!response.ok) {
                      setError(response.error);
                      setConflictDraft(null);
                      return;
                    }
                    revision.current = (response.data as { revision: number }).revision;
                    setConflict(false);
                    setConflictDraft(null);
                    setDirty(false);
                    setSaveState('Saved');
                  }}
                >
                  Keep my copy as a new draft revision
                </Button>
              </div>
            )}

            <Button
              variant="outline"
              onClick={() => {
                setConflict(false);
                setDirty(false);
                initialized.current = false;
                void load(area);
              }}
            >
              Reload their changes
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const blob = new Blob([JSON.stringify(draft, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'automation-draft.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download my copy
            </Button>
          </div>
        )}
        {localCopy && data?.canEdit && (
          <div className="flex items-center gap-2 text-sm">
            A local recovery copy is available.
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                try {
                  const parsed = snapshotSchema.parse(JSON.parse(localCopy));
                  edit(parsed);
                  setLocalCopy(null);
                } catch {
                  setError('Recovery copy is invalid');
                }
              }}
            >
              Review recovered draft
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLocalCopy(null)}>
              Dismiss
            </Button>
          </div>
        )}
        <nav aria-label="Automation sections" className="flex gap-1 overflow-x-auto border-b">
          {(['overview', 'context', 'rules', 'test', 'activity'] as Area[]).map(tab => (
            <Button
              key={tab}
              variant={area === tab ? 'secondary' : 'ghost'}
              className="capitalize shrink-0"
              onClick={() => setArea(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </Button>
          ))}
        </nav>
        {!data && <p>Loading automation…</p>}
        {data && area === 'overview' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Evaluated · 7 days', counts?.evaluated],
                ['Same behavior', counts?.same],
                ['Different routes', counts?.routes],
                ['Fallbacks / errors', counts?.errors],
              ].map(([label, value]) => (
                <Card key={String(label)}>
                  <CardHeader>
                    <CardTitle className="text-sm">{label}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">{value ?? 0}</CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm">
              Different priority: {counts?.priorities ?? 0} · Would skip escalation:{' '}
              {counts?.skips ?? 0}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setArea('rules')}>Edit automation</Button>
              <Button variant="outline" onClick={() => setArea('test')}>
                Test an event
              </Button>
            </div>
            <h3 className="font-semibold">Recent evaluations</h3>
            {data.traces.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Enable shadow mode after publishing to compare behavior.
              </p>
            )}
            <label className="block text-sm">
              Filter evaluations
              <select
                className={`${controlClass} ml-2`}
                value={traceFilter}
                onChange={event => setTraceFilter(event.target.value)}
              >
                <option value="ALL">All recent evaluations</option>
                <option value="NO_ESCALATION">Would skip escalation</option>
                <option value="ESCALATION_POLICY">Selected policy</option>
                <option value="ERROR">Fallbacks / errors</option>
              </select>
            </label>
            {data.traces
              .filter(trace => {
                const detail = trace.detail as {
                  result?: { outcome?: { type?: string } };
                  fallbackReason?: string;
                };
                return (
                  traceFilter === 'ALL' ||
                  (traceFilter === 'ERROR'
                    ? !!detail.fallbackReason
                    : detail.result?.outcome?.type === traceFilter)
                );
              })
              .map(trace => (
                <details key={trace.id} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm">
                    <Link className="underline" href={`/incidents/${trace.incidentId}`}>
                      Incident
                    </Link>{' '}
                    · {trace.mode} · {trace.fallbackReason ?? 'Evaluated'} ·{' '}
                    {trace.durationMs.toFixed(2)} ms
                  </summary>
                  <TraceDetail detail={trace.detail} />
                </details>
              ))}
          </>
        )}
        {data && area === 'context' && (
          <>
            <p className="text-sm text-muted-foreground">
              Define canonical context from fields observed in your integrations. Unmapped choices
              never satisfy negative conditions.
            </p>
            <Input
              aria-label="Search context fields"
              placeholder="Search context fields…"
              value={contextSearch}
              onChange={event => setContextSearch(event.target.value)}
            />
            {draft.fields
              .filter(field =>
                `${field.label} ${field.key}`.toLowerCase().includes(contextSearch.toLowerCase())
              )
              .map(field => (
                <Card key={field.key}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {field.label} <Badge>{field.type}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">
                      Recognized: {field.allowedValues?.join(', ') || field.type.toLowerCase()}
                    </p>
                    <p className="text-sm">
                      Aliases:{' '}
                      {Object.entries(field.aliases)
                        .map(([from, to]) => `${from} → ${to}`)
                        .join(', ') || 'None'}
                    </p>
                    {data.canEdit && (
                      <>
                        <label className="block text-sm">
                          Canonical choices
                          <Input
                            defaultValue={field.allowedValues?.join(', ') ?? ''}
                            disabled={field.type !== 'ENUM'}
                            onBlur={e =>
                              updateField(field.key, {
                                allowedValues: e.target.value
                                  .split(',')
                                  .map(v => v.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </label>
                        <AliasEditor
                          aliases={field.aliases}
                          onChange={aliases => updateField(field.key, { aliases })}
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={field.caseSensitive}
                            onChange={e =>
                              updateField(field.key, { caseSensitive: e.target.checked })
                            }
                          />
                          Case sensitive
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            edit({
                              ...draft,
                              fields: draft.fields.filter(f => f.key !== field.key),
                            })
                          }
                        >
                          Remove field
                        </Button>
                      </>
                    )}
                    <div>
                      {data.observations
                        .filter(o => o.fieldKey === field.key && o.unmapped)
                        .map(o => (
                          <div className="flex flex-wrap items-center gap-2 text-sm" key={o.id}>
                            <Badge variant="outline">Unmapped</Badge>
                            {o.rawValuePreview} · {o.count} alerts{' '}
                            {data.canEdit && (
                              <select
                                aria-label={`Map ${o.rawValuePreview}`}
                                className={controlClass}
                                value=""
                                onChange={e =>
                                  updateField(field.key, {
                                    aliases: {
                                      ...field.aliases,
                                      [o.rawValuePreview]: e.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="">Map value…</option>
                                {field.allowedValues?.map(v => (
                                  <option key={v}>{v}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            {data.canEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add context field</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="block text-sm">
                    1. Choose source
                    <select
                      className={`${controlClass} block w-full`}
                      value={integrationType}
                      onChange={e => setIntegrationType(e.target.value)}
                    >
                      <option>EVENTS_API</option>
                      <option value="ALL">All providers</option>
                      {[...new Set(data.integrations.map(i => i.type))].map(t => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    2. Choose observed field
                    <select
                      className={`${controlClass} block w-full`}
                      value={observedPath}
                      onChange={e => {
                        setObservedPath(e.target.value);
                        const found = [
                          ...data.observations.map(o => ({ path: o.sourcePath, key: o.fieldKey })),
                          ...discoveries,
                        ].find(o => o.path === e.target.value);
                        if (found) setFieldLabel(found.key.replace(/_/g, ' '));
                      }}
                    >
                      <option value="">Choose field…</option>
                      {[
                        ...new Map([
                          ...data.observations
                            .filter(
                              o =>
                                integrationType === 'ALL' || o.integrationType === integrationType
                            )
                            .map(o => [o.sourcePath, o.fieldKey] as const),
                          ...discoveries.map(o => [o.path, o.key] as const),
                        ]).entries(),
                      ].map(([path, key]) => (
                        <option key={path} value={path}>
                          {key.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Field label
                    <Input value={fieldLabel} onChange={e => setFieldLabel(e.target.value)} />
                  </label>
                  <label className="block text-sm">
                    3. Treat as
                    <select
                      className={`${controlClass} block w-full`}
                      value={fieldType}
                      onChange={e => setFieldType(e.target.value as Field['type'])}
                    >
                      <option value="STRING">Text</option>
                      <option value="ENUM">Choice</option>
                      <option value="NUMBER">Number</option>
                      <option value="BOOLEAN">True / False</option>
                    </select>
                  </label>
                  {fieldType === 'ENUM' && (
                    <label className="block text-sm">
                      4. Canonical values
                      <Input
                        value={values}
                        onChange={e => setValues(e.target.value)}
                        placeholder="production, staging"
                      />
                    </label>
                  )}
                  <Button onClick={addField}>Add field</Button>
                  <Button variant="ghost" onClick={() => setAdvanced(!advanced)}>
                    Advanced mapping
                  </Button>
                  {advanced && (
                    <label className="block text-sm">
                      Source path
                      <Input value={observedPath} onChange={e => setObservedPath(e.target.value)} />
                    </label>
                  )}
                  <details>
                    <summary className="cursor-pointer text-sm">
                      Discover fields from recent alerts or a sample
                    </summary>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        void (async () => {
                          setBusy(true);
                          try {
                            const response = await automationAction({
                              action: 'discoverRecent',
                              serviceId,
                            });
                            if (!response.ok) setError(response.error);
                            else {
                              setDiscoveries(response.data as Observation[]);
                              if (!(response.data as Observation[]).length)
                                setError(
                                  'No suitable fields in recent alerts. Use a provider sample to get started.'
                                );
                            }
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      Discover from recent alerts
                    </Button>
                    {discoveries.length > 0 && (
                      <div aria-label="Discovered context fields" className="my-3 space-y-2">
                        {discoveries.map(field => (
                          <div key={field.path} className="rounded-md border p-3 text-sm space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium">
                                {field.path.split('.').at(-1)?.replace(/_/g, ' ')}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setObservedPath(field.path);
                                  setFieldLabel(
                                    field.path.split('.').at(-1)?.replace(/_/g, ' ') ?? field.key
                                  );
                                  setFieldType(
                                    field.type === 'NUMBER' || field.type === 'BOOLEAN'
                                      ? field.type
                                      : 'STRING'
                                  );
                                }}
                              >
                                Choose field
                              </Button>
                            </div>
                            <p className="break-all text-muted-foreground">
                              {field.path} · {field.type}
                              {field.frequency ? ` · ${field.frequency} recent alerts` : ''}
                            </p>
                            <p className="break-words">
                              Examples: {(field.examples ?? [field.value]).join(', ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    <textarea
                      aria-label="Discovery sample"
                      className={`${controlClass} w-full min-h-32`}
                      value={providerSample}
                      onChange={e => setProviderSample(e.target.value)}
                    />
                    <Button size="sm" onClick={() => void analyze()}>
                      Analyze sample
                    </Button>
                  </details>
                </CardContent>
              </Card>
            )}
          </>
        )}
        {data && area === 'rules' && (
          <>
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="Search rules"
                placeholder="Search rules…"
                value={ruleSearch}
                onChange={event => setRuleSearch(event.target.value)}
                className="flex-1 min-w-40"
              />
              <select
                aria-label="Filter rules"
                className={controlClass}
                value={ruleStateFilter}
                onChange={event => setRuleStateFilter(event.target.value)}
              >
                <option value="all">All rules</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpandedRules(new Set(draft.rules.map(rule => rule.id)))}
              >
                Expand all
              </Button>
              <Button variant="outline" size="sm" onClick={() => setExpandedRules(new Set())}>
                Collapse all
              </Button>
            </div>
            {draft.rules.length === 0 && data.canEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">What would you like to automate?</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {[
                    ['production', 'Route production alerts'],
                    ['environment', 'Route by environment'],
                    ['account', 'Route by AWS account'],
                    ['priority', 'Route by alert priority'],
                    ['vip', 'VIP/customer routing'],
                    ['scratch', 'Start from scratch'],
                  ].map(([key, label]) => (
                    <Button variant="outline" key={key} onClick={() => createTemplate(key)}>
                      {label}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            )}
            {issues.map((issue, i) => (
              <p
                key={i}
                role={issue.level === 'ERROR' ? 'alert' : undefined}
                className={`rounded-md border p-2 text-sm ${issue.level === 'ERROR' ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {issue.level}: {issue.message}
              </p>
            ))}
            {(['ENRICH', 'ROUTE'] as const).map(phase => (
              <div key={phase} className="space-y-3">
                <h3 className="font-semibold">
                  {phase === 'ENRICH'
                    ? 'Enrichment · ordered writes'
                    : 'Routing · first match wins'}
                </h3>
                {draft.rules
                  .filter(r => r.phase === phase)
                  .filter(
                    r =>
                      r.name.toLowerCase().includes(ruleSearch.toLowerCase()) &&
                      (ruleStateFilter === 'all' || r.enabled === (ruleStateFilter === 'enabled'))
                  )
                  .map(rule => {
                    const index = draft.rules.indexOf(rule);
                    return (
                      <Card
                        key={rule.id}
                        onDragOver={event => event.preventDefault()}
                        onDrop={event => {
                          event.preventDefault();
                          const source = draft.rules.findIndex(
                            candidate => candidate.id === draggedRule.current
                          );
                          if (
                            !data.canEdit ||
                            source < 0 ||
                            draft.rules[source].phase !== rule.phase
                          )
                            return;
                          const rules = [...draft.rules];
                          const [moved] = rules.splice(source, 1);
                          rules.splice(index, 0, moved);
                          edit({ ...draft, rules });
                          draggedRule.current = null;
                        }}
                      >
                        <CardContent className="pt-4 space-y-3">
                          <button
                            type="button"
                            aria-expanded={expandedRules.has(rule.id)}
                            aria-label={`Configure ${rule.name}`}
                            className="w-full text-left rounded-md focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() =>
                              setExpandedRules(previous => {
                                const next = new Set(previous);
                                if (next.has(rule.id)) next.delete(rule.id);
                                else next.add(rule.id);
                                return next;
                              })
                            }
                          >
                            <span className="font-semibold text-sm">
                              {draft.rules.filter(item => item.phase === phase).indexOf(rule) + 1}.{' '}
                              {rule.name}{' '}
                              <Badge variant="secondary">
                                {rule.enabled ? 'Enabled' : 'Disabled'}
                              </Badge>
                            </span>
                            <span className="block mt-1 text-sm text-muted-foreground">
                              IF{' '}
                              {rule.conditions.length
                                ? rule.conditions
                                    .map(
                                      condition =>
                                        `${fields.find(field => field.key === condition.fieldKey)?.label ?? condition.fieldKey} ${condition.operator.replaceAll('_', ' ').toLowerCase()} ${Array.isArray(condition.value) ? condition.value.join(', ') : (condition.value ?? '')}`
                                    )
                                    .join(' and ')
                                : 'every alert'}{' '}
                              → {phase === 'ROUTE' ? 'ROUTE TO' : 'THEN'}{' '}
                              {rule.actions
                                .map(action =>
                                  action.type === 'USE_ESCALATION_POLICY'
                                    ? (data.policies.find(policy => policy.id === action.policyId)
                                        ?.name ?? 'Selected policy')
                                    : action.type.replaceAll('_', ' ').toLowerCase()
                                )
                                .join(', ')}
                            </span>
                          </button>
                          {expandedRules.has(rule.id) && (
                            <div className="space-y-3 border-t pt-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge>
                                  {draft.rules.filter(item => item.phase === phase).indexOf(rule) +
                                    1}
                                </Badge>
                                {data.canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    draggable
                                    onDragStart={() => {
                                      draggedRule.current = rule.id;
                                    }}
                                    onDragEnd={() => {
                                      draggedRule.current = null;
                                    }}
                                    aria-label={`Drag rule ${draft.rules.filter(item => item.phase === phase).indexOf(rule) + 1}`}
                                  >
                                    ↕
                                  </Button>
                                )}
                                <Input
                                  aria-label="Rule name"
                                  className="flex-1 min-w-40"
                                  disabled={!data.canEdit}
                                  value={rule.name}
                                  onChange={e => updateRule(rule.id, { name: e.target.value })}
                                />
                                {data.canEdit && (
                                  <>
                                    <Button
                                      aria-label="Move rule up"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => move(index, -1)}
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      aria-label="Move rule down"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => move(index, 1)}
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      aria-label="Delete rule"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() =>
                                        edit({
                                          ...draft,
                                          rules: draft.rules.filter(r => r.id !== rule.id),
                                        })
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  disabled={!data.canEdit}
                                  checked={rule.enabled}
                                  onChange={e => updateRule(rule.id, { enabled: e.target.checked })}
                                />
                                Enabled
                              </label>
                              <p className="text-sm font-medium">
                                IF{' '}
                                {rule.conditions.length === 0
                                  ? 'any alert arrives'
                                  : 'all conditions match'}
                              </p>
                              {rule.conditions.map((condition, n) => (
                                <div key={n} className="flex flex-wrap gap-2">
                                  <select
                                    aria-label="Condition field"
                                    className={controlClass}
                                    disabled={!data.canEdit}
                                    value={condition.fieldKey}
                                    onChange={e => {
                                      const conditions = [...rule.conditions];
                                      conditions[n] = {
                                        fieldKey: e.target.value,
                                        operator: 'IS_SET',
                                      };
                                      updateRule(rule.id, { conditions });
                                    }}
                                  >
                                    {fields.map(f => (
                                      <option key={f.key} value={f.key}>
                                        {f.label}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    aria-label="Condition operator"
                                    className={controlClass}
                                    disabled={!data.canEdit}
                                    value={condition.operator}
                                    onChange={e => {
                                      const conditions = [...rule.conditions];
                                      const operator = e.target.value as Condition['operator'];
                                      conditions[n] = {
                                        ...condition,
                                        operator,
                                        value: operator.startsWith('IS_')
                                          ? undefined
                                          : ['IN', 'NOT_IN'].includes(operator)
                                            ? []
                                            : '',
                                      };
                                      updateRule(rule.id, { conditions });
                                    }}
                                  >
                                    {Object.entries({
                                      EQ: 'is',
                                      NE: 'is not',
                                      IN: 'is one of',
                                      NOT_IN: 'is not one of',
                                      LT: 'less than',
                                      LTE: 'at most',
                                      GT: 'greater than',
                                      GTE: 'at least',
                                      IS_SET: 'is set',
                                      IS_MISSING: 'is missing',
                                      IS_UNMAPPED: 'is unmapped',
                                    }).map(([key, label]) => (
                                      <option key={key} value={key}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                  {!condition.operator.startsWith('IS_') && (
                                    <TypedValueInput
                                      label="Condition value"
                                      type={fields.find(f => f.key === condition.fieldKey)?.type}
                                      disabled={!data.canEdit}
                                      value={condition.value}
                                      list={['IN', 'NOT_IN'].includes(condition.operator)}
                                      onChange={value => {
                                        const conditions = [...rule.conditions];
                                        conditions[n] = { ...condition, value };
                                        updateRule(rule.id, { conditions });
                                      }}
                                    />
                                  )}
                                  {data.canEdit && (
                                    <Button
                                      aria-label="Remove condition"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        updateRule(rule.id, {
                                          conditions: rule.conditions.filter((_, i) => i !== n),
                                        })
                                      }
                                    >
                                      Remove
                                    </Button>
                                  )}
                                </div>
                              ))}
                              {data.canEdit && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    updateRule(rule.id, {
                                      conditions: [
                                        ...rule.conditions,
                                        { fieldKey: fields[0].key, operator: 'IS_SET' },
                                      ],
                                    })
                                  }
                                >
                                  Add condition
                                </Button>
                              )}
                              <p className="text-sm font-medium">
                                {phase === 'ENRICH' ? 'Set' : 'Route to'}
                              </p>
                              <h4 className="font-semibold text-sm">
                                {phase === 'ROUTE' ? 'ROUTE TO' : 'THEN'}
                              </h4>
                              {rule.actions.map((action, n) => (
                                <ActionEditor
                                  key={n}
                                  action={action}
                                  phase={phase}
                                  fields={fields}
                                  policies={data.policies}
                                  destinations={data.destinations}
                                  disabled={!data.canEdit}
                                  onChange={next => {
                                    const actions = [...rule.actions];
                                    actions[n] = next;
                                    updateRule(rule.id, { actions });
                                  }}
                                  onRemove={() =>
                                    updateRule(rule.id, {
                                      actions: rule.actions.filter((_, i) => i !== n),
                                    })
                                  }
                                />
                              ))}
                              {data.canEdit && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    updateRule(rule.id, {
                                      actions: [
                                        ...rule.actions,
                                        phase === 'ENRICH'
                                          ? { type: 'ADD_TAG', value: 'tag' }
                                          : {
                                              type: 'NOTIFY_CHANNEL',
                                              provider: 'SLACK',
                                              destinationId: data.destinations[0]?.id ?? '',
                                            },
                                      ],
                                    })
                                  }
                                >
                                  Add{' '}
                                  {phase === 'ENRICH'
                                    ? 'enrichment action'
                                    : 'channel notification'}
                                </Button>
                              )}
                              <p className="border-t pt-3 text-sm text-muted-foreground">
                                {rule.name}:{' '}
                                {rule.conditions.length
                                  ? rule.conditions
                                      .map(
                                        c =>
                                          `${fields.find(f => f.key === c.fieldKey)?.label ?? c.fieldKey} ${c.operator.replaceAll('_', ' ').toLowerCase()} ${Array.isArray(c.value) ? c.value.join(', ') : (c.value ?? '')}`
                                      )
                                      .join(' and ')
                                  : 'Every alert'}{' '}
                                →{' '}
                                {rule.actions
                                  .map(a =>
                                    a.type === 'USE_ESCALATION_POLICY'
                                      ? (data.policies.find(p => p.id === a.policyId)?.name ??
                                        'Selected policy')
                                      : a.type.replaceAll('_', ' ').toLowerCase()
                                  )
                                  .join(', ')}
                                .
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                {data.canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const rule = newRule(phase);
                      setExpandedRules(previous => new Set([...previous, rule.id]));
                      edit({
                        ...draft,
                        rules:
                          phase === 'ENRICH'
                            ? [
                                ...draft.rules.filter(r => r.phase === 'ENRICH'),
                                rule,
                                ...draft.rules.filter(r => r.phase === 'ROUTE'),
                              ]
                            : [...draft.rules, rule],
                      });
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add {phase === 'ENRICH' ? 'enrichment' : 'routing'} rule
                  </Button>
                )}
              </div>
            ))}
            <p className="rounded-lg border p-3 text-sm">
              Fallback: service default escalation when no routing rule matches or evaluation fails.
            </p>
          </>
        )}
        {data && area === 'test' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sample tests use the production evaluator and create no incidents or notifications.
            </p>
            <label className="block text-sm">
              Use recent alert
              <select
                className={`${controlClass} block w-full`}
                onChange={e => {
                  const alert = data.alerts.find(a => a.id === e.target.value);
                  if (alert)
                    setSample(
                      JSON.stringify(
                        { event_action: 'trigger', dedup_key: 'sample', payload: alert.payload },
                        null,
                        2
                      )
                    );
                }}
              >
                <option value="">Choose recent alert…</option>
                {data.alerts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Integration
              <select
                className={`${controlClass} block w-full`}
                value={integrationId}
                onChange={e => {
                  setIntegrationId(e.target.value);
                  setIntegrationType(
                    data.integrations.find(i => i.id === e.target.value)?.type ?? 'EVENTS_API'
                  );
                }}
              >
                <option value="">Events API</option>
                {data.integrations.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <ManualSample onBuild={setSample} />
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="text-sm">
                Paste sample event · Normalized event
                <textarea
                  className={`${controlClass} w-full min-h-56 font-mono text-xs`}
                  value={sample}
                  onChange={e => setSample(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Provider input
                <textarea
                  className={`${controlClass} w-full min-h-56 font-mono text-xs`}
                  value={providerSample}
                  onChange={e => setProviderSample(e.target.value)}
                />
              </label>
            </div>
            <Button disabled={busy} onClick={() => void runTest()}>
              Test sample
            </Button>
            {result && (
              <div className="space-y-3">
                <p>
                  Base classification: {result.classification?.priority ?? 'Unset'} ·{' '}
                  {result.classification?.urgency ?? 'Unknown'}
                </p>
                {result.issues.map((i, n) => (
                  <p key={n} className="text-sm">
                    {i.level}: {i.message}
                  </p>
                ))}
                {result.result && (
                  <TraceDetail
                    detail={{
                      result: result.result,
                      normalization: 'normalization' in result ? result.normalization : [],
                      actual: {
                        priority: result.classification?.priority,
                        route: 'SERVICE_DEFAULT',
                      },
                    }}
                  />
                )}
                <p className="text-sm text-muted-foreground">
                  {result.durationMs.toFixed(2)} ms ·{' '}
                  {result.goldenResults.filter(f => f.expected === f.actual).length}/
                  {result.goldenResults.length} semantic fixtures passed
                </p>
              </div>
            )}
          </div>
        )}
        {data && area === 'activity' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Button
                size="sm"
                variant="outline"
                disabled={activityPage <= 1}
                onClick={() => setActivityPage(page => page - 1)}
              >
                Previous versions
              </Button>
              <span>
                Page {activityPage} · {data.versionTotal} versions
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={activityPage * 20 >= data.versionTotal}
                onClick={() => setActivityPage(page => page + 1)}
              >
                Next versions
              </Button>
            </div>
            {data.versions.length === 0 && <p>No published versions yet.</p>}
            {data.versions.map(version => (
              <Card key={version.id}>
                <CardContent className="pt-5 space-y-2">
                  <div className="font-medium">
                    Version {version.versionNumber}{' '}
                    {version.id === data.activeVersionId && <Badge>Active</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Published {new Date(version.publishedAt).toLocaleString()} ·{' '}
                    {version.publishedBy}
                    {version.sourceVersionId ? ' · Restored from previous version' : ''}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVersionView(versionView === version.id ? null : version.id)}
                    >
                      View / compare
                    </Button>
                    {data.canPublish && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void command({ action: 'publish', sourceVersionId: version.id })
                        }
                      >
                        Restore as new version
                      </Button>
                    )}
                  </div>
                  {versionView === version.id && (
                    <div className="text-sm space-y-2">
                      {snapshotSchema.parse(version.snapshot).rules.map(r => (
                        <p key={r.id}>
                          {r.phase} · {r.name} · {r.conditions.length} conditions ·{' '}
                          {r.actions.map(a => a.type.replaceAll('_', ' ').toLowerCase()).join(', ')}
                        </p>
                      ))}
                      <p>Compare with active:</p>
                      {compareSnapshots(
                        snapshotSchema.parse(data.activeVersion?.snapshot ?? emptySnapshot),
                        snapshotSchema.parse(version.snapshot)
                      ).map((change, index) => (
                        <p key={index}>{change}</p>
                      ))}
                      {compareSnapshots(
                        snapshotSchema.parse(data.activeVersion?.snapshot ?? emptySnapshot),
                        snapshotSchema.parse(version.snapshot)
                      ).length === 0 && <p>Same configuration</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </fieldset>
    </section>
  );
}

function TraceDetail({ detail }: { detail: unknown }) {
  const trace = detail as {
    result?: {
      inputContext?: Record<string, unknown>;
      enrichedContext?: Record<string, unknown>;
      writes?: Array<{ ruleId: string; fieldKey: string; value: unknown }>;
      enrichmentRuleResults?: Array<{ ruleName: string; result: string }>;
      routingRuleResults?: Array<{ ruleName: string; result: string }>;
      outcome?: { type: string; policyId?: string };
      supplementalActions?: Array<{ provider: string; destinationId: string }>;
    };
    actual?: { priority?: string; route?: string };
    fallbackReason?: string;
    normalization?: Array<{ fieldKey: string; raw: unknown; canonical: unknown }>;
  };
  const result = trace.result;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="font-medium">Current behavior</h4>
          <p>
            Priority {trace.actual?.priority ?? 'Unset'} ·{' '}
            {trace.actual?.route ?? 'Service default'}
          </p>
        </div>
        <div>
          <h4 className="font-medium">Automation outcome</h4>
          <p>
            {trace.fallbackReason ??
              result?.outcome?.type.replaceAll('_', ' ').toLowerCase() ??
              'Service default'}
            {result?.outcome?.policyId ? ` · ${result.outcome.policyId}` : ''}
          </p>
          <p>Final priority: {formatState(result?.enrichedContext?.priority)}</p>
        </div>
      </div>
      <h4 className="font-medium">Extraction → canonical context</h4>
      {trace.normalization?.map(n => (
        <p key={n.fieldKey}>
          {n.fieldKey}: {String(n.raw ?? 'Missing')} → {formatState(n.canonical)}
        </p>
      ))}
      {Object.entries(result?.inputContext ?? {}).map(([key, value]) => (
        <p key={key}>
          {key}: {formatState(value)}
        </p>
      ))}
      <h4 className="font-medium">Enrichment</h4>
      {result?.enrichmentRuleResults?.map((r, i) => (
        <p key={i}>
          {r.ruleName}: {r.result}
        </p>
      ))}
      {result?.writes?.map((w, i) => (
        <p key={i}>
          {w.fieldKey} → {String(w.value)}
        </p>
      ))}
      <h4 className="font-medium">Routing</h4>
      {result?.routingRuleResults?.map((r, i) => (
        <p key={i}>
          {r.ruleName}: {r.result}
        </p>
      ))}
      {result?.supplementalActions?.map((a, i) => (
        <p key={i}>
          Also notify {a.provider} · {a.destinationId}
        </p>
      ))}
    </div>
  );
}

function ManualSample({ onBuild }: { onBuild: (sample: string) => void }) {
  const [summary, setSummary] = useState('Sample incident');
  const [severity, setSeverity] = useState('critical');
  const [environment, setEnvironment] = useState('production');
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">Build sample manually</summary>
      <div className="grid gap-3 mt-3 sm:grid-cols-3">
        <label className="text-sm">
          Summary
          <Input value={summary} onChange={event => setSummary(event.target.value)} />
        </label>
        <label className="text-sm">
          Severity
          <select
            className={`${controlClass} block w-full`}
            value={severity}
            onChange={event => setSeverity(event.target.value)}
          >
            {['critical', 'error', 'warning', 'info'].map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Environment
          <Input value={environment} onChange={event => setEnvironment(event.target.value)} />
        </label>
        <Button
          onClick={() =>
            onBuild(
              JSON.stringify(
                {
                  event_action: 'trigger',
                  dedup_key: 'manual-sample',
                  payload: {
                    summary,
                    severity,
                    source: 'manual-sample',
                    custom_details: { environment },
                  },
                },
                null,
                2
              )
            )
          }
        >
          Use manual sample
        </Button>
      </div>
    </details>
  );
}
