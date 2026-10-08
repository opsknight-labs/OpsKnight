/* eslint-disable security/detect-object-injection -- Array indices come from local map callbacks or bounds-checked rule ordering. */
'use client';
import { AutomationTest } from './AutomationTest';
import { AutomationContext } from './AutomationContext';
import { AutomationActivity } from './AutomationActivity';
import { AutomationRules } from './AutomationRules';
import { AutomationOverview } from './AutomationOverview';

import { AutomationReviewDialog } from './AutomationReviewDialog';

import { compareSnapshots } from '@/lib/automation/diff';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';

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

import { Badge } from '@/components/ui/shadcn/badge';
import type { testAutomation } from '@/lib/automation/testing';
import type { Observation } from '@/lib/automation/discovery';
import { Workflow } from 'lucide-react';
type Area = 'overview' | 'context' | 'rules' | 'test' | 'activity';
type Data = Awaited<ReturnType<typeof getAutomationArea>>;
type TestResult = Awaited<ReturnType<typeof testAutomation>>;
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
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
export default function AutomationWorkspace({
  serviceId,
  mobile = false,
}: {
  serviceId: string;
  mobile?: boolean;
}) {
  const [review, setReview] = useState<'publish' | 'restore' | 'LIVE' | null>(null);
  const [ruleSearch, setRuleSearch] = useState('');
  const [contextSearch, setContextSearch] = useState('');
  const [ruleStateFilter, setRuleStateFilter] = useState('all');
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
  const [activityPage, setActivityPage] = useState(1);
  const [area, setArea] = useState<Area>('overview');
  const [areaData, setAreaData] = useState<Partial<Record<Area, Data>>>({});
  const [restoreVersion, setRestoreVersion] = useState<
    (Data['versions'][number] & { snapshot: Snapshot }) | null
  >(null);
  const [undo, setUndo] = useState<{
    label: string;
    restore: (current: Snapshot) => Snapshot;
  } | null>(null);
  const [deleteField, setDeleteField] = useState<Field | null>(null);
  const [reviewData, setReviewData] = useState<Data | null>(null);
  const data = areaData[area] ?? null;
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
  const [values, setValues] = useState<string[]>(['production', 'staging', 'development']);
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
        if (
          next.activeVersion?.snapshot &&
          !snapshotSchema.safeParse(next.activeVersion.snapshot).success
        )
          throw new Error(
            `Version ${next.activeVersion.versionNumber} failed integrity validation and cannot be rendered`
          );
        if (!initialized.current) revision.current = next.draft.revision;
        if (!initialized.current && ['context', 'rules', 'test'].includes(nextArea)) {
          const parsed = snapshotSchema.safeParse(next.draft.snapshot);
          if (!parsed.success)
            throw new Error('Stored draft failed integrity validation and cannot be rendered');
          setDraft(parsed.data);
          revision.current = next.draft.revision;
          initialized.current = true;
        }
        setAreaData(previous => ({ ...previous, [nextArea]: next }));
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
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(timer);
  }, [undo]);
  const removeRule = (rule: Rule) => {
    const index = draft.rules.findIndex(r => r.id === rule.id);
    setUndo({
      label: `${rule.name} deleted`,
      restore: current => ({
        ...current,
        rules: [...current.rules.slice(0, index), rule, ...current.rules.slice(index)],
      }),
    });
    edit({ ...draft, rules: draft.rules.filter(r => r.id !== rule.id) });
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
        expectedActiveVersionId: review
          ? (reviewData?.activeVersionId ?? null)
          : (data?.activeVersionId ?? null),
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
  const issues = useMemo(() => {
    try {
      return compileAutomation(draft).issues;
    } catch (err) {
      return [
        {
          level: 'ERROR' as const,
          code: 'INVALID_DRAFT',
          message: err instanceof Error ? err.message : 'Invalid draft',
        },
      ];
    }
  }, [draft]);
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
    const existingField = draft.fields.find(candidate => candidate.key === field.key);
    const condition: Condition =
      kind === 'priority'
        ? { fieldKey: 'priority', operator: 'IN', value: ['P1', 'P2'] }
        : {
            fieldKey: field.key,
            operator: 'EQ',
            value:
              kind === 'account' ? '123456789012' : kind === 'vip' ? 'enterprise' : 'production',
          };
    if (
      kind !== 'priority' &&
      kind !== 'scratch' &&
      draft.fields.some(f => f.key === field.key && f.type !== field.type)
    ) {
      setError(
        'This template conflicts with an existing context field type. Start from scratch or edit the field first.'
      );
      return;
    }
    let templateFields = draft.fields;
    if (kind !== 'priority' && kind !== 'scratch' && existingField?.type === 'ENUM') {
      const canonical = existingField.allowedValues?.find(value =>
        existingField.caseSensitive
          ? value === 'production'
          : value.trim().toLowerCase() === 'production'
      );
      condition.value = canonical ?? 'production';
      if (!canonical && (existingField.allowedValues?.length ?? 0) >= 200) {
        setError(
          'The environment field has reached its canonical choice limit. Add a compatible production choice before using this template.'
        );
        return;
      }
      if (!canonical)
        templateFields = draft.fields.map(candidate =>
          candidate.fieldId === existingField.fieldId
            ? { ...candidate, allowedValues: [...(candidate.allowedValues ?? []), 'production'] }
            : candidate
        );
    }
    edit({
      schemaVersion: 1,
      fields:
        kind === 'priority' || kind === 'scratch' || draft.fields.some(f => f.key === field.key)
          ? templateFields
          : [...templateFields, field],
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
                allowedValues: values,
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
  const counts = (review === 'LIVE' ? reviewData : data)?.aggregates
    .filter(row => review !== 'LIVE' || row.versionId === reviewData?.activeVersionId)
    .reduce(
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
        key={`${review}:${review === 'LIVE' ? reviewData?.activeVersionId : (restoreVersion?.id ?? data?.activeVersionId)}`}
        action={review}
        policies={reviewData?.policies}
        destinations={reviewData?.destinations}
        before={snapshotSchema.parse(reviewData?.activeVersion?.snapshot ?? emptySnapshot)}
        mode={data?.mode ?? 'DISABLED'}
        snapshot={
          review === 'LIVE' && reviewData?.activeVersion
            ? snapshotSchema.parse(reviewData.activeVersion.snapshot)
            : review === 'restore' && restoreVersion
              ? snapshotSchema.parse(restoreVersion.snapshot)
              : draft
        }
        version={(review === 'LIVE' ? reviewData : data)?.activeVersion?.versionNumber ?? null}
        enabled={data?.enabled ?? false}
        counts={counts}
        busy={busy}
        error={error}
        onCancel={() => setReview(null)}
        onConfirm={(acknowledgeNoShadow, acknowledgeShadowErrors) => {
          void command(
            review === 'LIVE'
              ? { action: 'mode', mode: 'LIVE', acknowledgeNoShadow, acknowledgeShadowErrors }
              : {
                  action: 'publish',
                  ...(review === 'restore' ? { sourceVersionId: restoreVersion?.id } : {}),
                }
          ).then(success => {
            if (success) setReview(null);
          });
        }}
      />
      {undo && (
        <div
          role="status"
          className="rounded-lg border p-3 flex items-center justify-between gap-3"
        >
          <span>{undo.label}</span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              edit(undo.restore(draftRef.current));
              setUndo(null);
            }}
          >
            Undo
          </Button>
        </div>
      )}
      {deleteField && (
        <div
          role="alertdialog"
          aria-label="Remove context field"
          className="rounded-lg border p-4 space-y-3"
        >
          <p>
            {deleteField.label} is used by{' '}
            {
              draft.rules.filter(
                r =>
                  r.conditions.some(c => c.fieldKey === deleteField.key) ||
                  r.actions.some(a => a.type === 'SET_CONTEXT' && a.fieldKey === deleteField.key)
              ).length
            }{' '}
            rules. Update those rules before removing this field.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setRuleSearch('');
              setArea('rules');
              setExpandedRules(
                new Set(
                  draft.rules
                    .filter(
                      r =>
                        r.conditions.some(c => c.fieldKey === deleteField.key) ||
                        r.actions.some(
                          a => a.type === 'SET_CONTEXT' && a.fieldKey === deleteField.key
                        )
                    )
                    .map(r => r.id)
                )
              );
              setDeleteField(null);
            }}
          >
            View affected rules
          </Button>
          <Button variant="outline" onClick={() => setDeleteField(null)}>
            Cancel
          </Button>
          <Button
            disabled={draft.rules.some(
              r =>
                r.conditions.some(c => c.fieldKey === deleteField.key) ||
                r.actions.some(a => a.type === 'SET_CONTEXT' && a.fieldKey === deleteField.key)
            )}
            onClick={() => {
              const field = deleteField,
                index = draft.fields.findIndex(f => f.key === field.key);
              const affected = draft.rules.filter(
                r =>
                  r.conditions.some(c => c.fieldKey === field.key) ||
                  r.actions.some(a => a.type === 'SET_CONTEXT' && a.fieldKey === field.key)
              );
              setUndo({
                label: `${field.label} removed; affected rules disabled`,
                restore: current => ({
                  ...current,
                  fields: [
                    ...current.fields.slice(0, index),
                    field,
                    ...current.fields.slice(index),
                  ],
                  rules: current.rules.map(r => affected.find(a => a.id === r.id) ?? r),
                }),
              });
              edit({
                ...draft,
                fields: draft.fields.filter(f => f.key !== field.key),
                rules: draft.rules.map(r =>
                  affected.some(a => a.id === r.id)
                    ? {
                        ...r,
                        enabled: false,
                        conditions: r.conditions.filter(c => c.fieldKey !== field.key),
                        actions: r.actions.filter(
                          a => !(a.type === 'SET_CONTEXT' && a.fieldKey === field.key)
                        ),
                      }
                    : r
                ),
              });
              setDeleteField(null);
            }}
          >
            Confirm field removal
          </Button>
        </div>
      )}
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Automation <Badge>{data?.mode ?? 'Loading…'}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              Version {data?.activeVersion?.versionNumber ?? '—'} · {saveState} · Global{' '}
              {data?.enabled ? 'ON' : 'OFF'}
            </p>
            {data?.activeVersion && (
              <p className="text-xs text-muted-foreground">
                Last published {new Date(data.activeVersion.publishedAt).toLocaleString()}
              </p>
            )}
          </div>
          {data?.canPublish && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || conflict || issues.some(i => i.level === 'ERROR')}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      const loaded = await load('rules');
                      if (loaded) {
                        setReviewData(loaded);
                        setReview('publish');
                      }
                    } finally {
                      setBusy(false);
                    }
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
                        if (loaded) {
                          setReviewData(loaded);
                          setReview('LIVE');
                        }
                      })
                      .finally(() => setBusy(false));
                  } else void command({ action: 'mode', mode: e.target.value });
                }}
              >
                <option>DISABLED</option>
                <option disabled={!data.enabled}>SHADOW</option>
                <option disabled={!data.enabled}>LIVE</option>
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
                const parsed = snapshotSchema.safeParse(remote.draft.snapshot);
                if (!parsed.success) {
                  setError('Stored draft failed integrity validation');
                  return;
                }
                setConflictDraft({
                  snapshot: parsed.data,
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
                    const savedGeneration = generation.current;
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
                    persistedGeneration.current = savedGeneration;
                    setConflict(false);
                    setConflictDraft(null);
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
        <nav
          aria-label="Automation sections"
          className={
            mobile ? 'grid grid-cols-3 gap-1 border-b pb-2' : 'flex gap-1 overflow-x-auto border-b'
          }
        >
          {(['overview', 'context', 'rules', 'test', 'activity'] as Area[]).map(tab => (
            <Button
              key={tab}
              variant={area === tab ? 'secondary' : 'ghost'}
              aria-pressed={area === tab}
              className="capitalize shrink-0"
              onClick={() => setArea(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </Button>
          ))}
        </nav>
        {!data && <p>Loading automation…</p>}
        {data && area === 'overview' && (
          <AutomationOverview
            data={data}
            counts={counts}
            traceFilter={traceFilter}
            setTraceFilter={setTraceFilter}
            setArea={setArea}
          />
        )}
        {data && area === 'context' && (
          <AutomationContext
            data={data}
            draft={draft}
            contextSearch={contextSearch}
            setContextSearch={setContextSearch}
            updateField={updateField}
            setDeleteField={setDeleteField}
            integrationType={integrationType}
            setIntegrationType={setIntegrationType}
            observedPath={observedPath}
            setObservedPath={setObservedPath}
            discoveries={discoveries}
            setDiscoveries={setDiscoveries}
            fieldLabel={fieldLabel}
            setFieldLabel={setFieldLabel}
            fieldType={fieldType}
            setFieldType={setFieldType}
            values={values}
            setValues={setValues}
            addField={addField}
            advanced={advanced}
            setAdvanced={setAdvanced}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            serviceId={serviceId}
            providerSample={providerSample}
            setProviderSample={setProviderSample}
            analyze={analyze}
          />
        )}
        {data && area === 'rules' && (
          <AutomationRules
            data={data}
            draft={draft}
            fields={fields}
            ruleSearch={ruleSearch}
            setRuleSearch={setRuleSearch}
            ruleStateFilter={ruleStateFilter}
            setRuleStateFilter={setRuleStateFilter}
            expandedRules={expandedRules}
            setExpandedRules={setExpandedRules}
            draggedRule={draggedRule}
            edit={edit}
            updateRule={updateRule}
            move={move}
            removeRule={removeRule}
            mobile={mobile}
            createTemplate={createTemplate}
            newRule={newRule}
            issues={issues}
          />
        )}
        {data && area === 'test' && (
          <AutomationTest
            data={data}
            integrationId={integrationId}
            setIntegrationId={setIntegrationId}
            setIntegrationType={setIntegrationType}
            sample={sample}
            setSample={setSample}
            providerSample={providerSample}
            setProviderSample={setProviderSample}
            busy={busy}
            runTest={runTest}
            result={result}
          />
        )}
        {data && area === 'activity' && (
          <AutomationActivity
            serviceId={serviceId}
            data={data}
            activityPage={activityPage}
            setActivityPage={setActivityPage}
            versionView={versionView}
            setVersionView={setVersionView}
            busy={busy}
            onRestore={version => {
              setRestoreVersion(version);
              setBusy(true);
              void load('rules')
                .then(loaded => {
                  if (loaded) {
                    setReviewData(loaded);
                    setReview('restore');
                  }
                })
                .finally(() => setBusy(false));
            }}
          />
        )}
      </fieldset>
    </section>
  );
}
