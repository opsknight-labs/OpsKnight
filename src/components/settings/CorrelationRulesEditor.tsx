'use client';

import { useActionState, useId, useState } from 'react';
import {
  previewCorrelationRules,
  publishCorrelationRules,
  type IntelligenceActionState,
  type RulePreviewState,
} from '@/app/(app)/settings/intelligence/actions';
import { Button } from '@/components/ui/shadcn/button';
import {
  CORRELATION_RULE_KINDS,
  MAX_CORRELATION_RULES_PER_POLICY,
  MAX_CORRELATION_WINDOW_SECONDS,
  MIN_CORRELATION_WINDOW_SECONDS,
  type CorrelationRule,
  type CorrelationRuleKind,
} from '@/lib/intelligence/contract';

const field = 'w-full rounded-md border border-border bg-background p-2 text-sm';
const KIND_LABEL = new Map<CorrelationRuleKind, string>([
  ['CONTENT_TEMPLATE', 'Same wording (masked title)'],
  ['EXACT_FIELD', 'Same field values (service, template, labels)'],
  ['LABEL_SET', 'Same label values'],
]);
const KIND_HINT = new Map<CorrelationRuleKind, string>([
  ['CONTENT_TEMPLATE', 'Incidents whose titles are the same once ids, numbers and hosts are ignored.'],
  ['EXACT_FIELD', 'Comma-separated names: "service", "template" or label keys, e.g. service, env.'],
  ['LABEL_SET', 'Comma-separated label keys that must all match, e.g. cluster, namespace.'],
]);

const blankDraft = { id: '', kind: 'CONTENT_TEMPLATE' as CorrelationRuleKind, keys: '', windowSeconds: 300, maxWindowSeconds: 900 };

/** Edits the global policy's grouping rules, previews them on real history, then publishes a new version. */
export default function CorrelationRulesEditor({
  initialRules,
  headVersion,
  canManage,
  maxLookbackDays,
}: {
  initialRules: CorrelationRule[];
  headVersion: number;
  canManage: boolean;
  maxLookbackDays: number;
}) {
  const [rules, setRules] = useState<CorrelationRule[]>(initialRules);
  const [draft, setDraft] = useState(blankDraft);
  const [draftError, setDraftError] = useState('');
  const [days, setDays] = useState(Math.min(14, maxLookbackDays));
  const id = useId();
  const [preview, previewAction, previewing] = useActionState<RulePreviewState, FormData>(previewCorrelationRules, { message: '', ok: false });
  const [published, publishAction, publishing] = useActionState<IntelligenceActionState, FormData>(publishCorrelationRules, { message: '', ok: false });
  const rulesJson = JSON.stringify(rules);

  const addRule = () => {
    const keys = draft.keys.split(',').map(key => key.trim().toLowerCase()).filter(Boolean);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(draft.id)) return setDraftError('Rule ids use lowercase letters, digits, "-" and "_".');
    if (rules.some(rule => rule.id === draft.id)) return setDraftError('A rule with that id already exists.');
    if (draft.kind !== 'CONTENT_TEMPLATE' && keys.length === 0) return setDraftError('This kind of rule needs at least one key.');
    if (draft.windowSeconds < MIN_CORRELATION_WINDOW_SECONDS || draft.maxWindowSeconds < draft.windowSeconds || draft.maxWindowSeconds > MAX_CORRELATION_WINDOW_SECONDS) {
      return setDraftError('Check the time window: it must be at least 30 seconds, and the maximum cannot be shorter or exceed 24 hours.');
    }
    if (rules.length >= MAX_CORRELATION_RULES_PER_POLICY) return setDraftError(`A policy can have at most ${MAX_CORRELATION_RULES_PER_POLICY} rules.`);
    setRules([...rules, { id: draft.id, kind: draft.kind, enabled: true, keys, windowSeconds: draft.windowSeconds, maxWindowSeconds: draft.maxWindowSeconds, minScore: 0.8 }]);
    setDraft(blankDraft);
    setDraftError('');
  };

  const p = preview.preview;
  return (
    <div className="space-y-5 py-4">
      <p className="text-sm text-muted-foreground">
        Rules group related incidents of the same service. Critical (highest urgency) incidents are never
        grouped. Grouping only ever suggests links for responders to confirm; it never merges incidents or
        changes paging.
      </p>

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules yet. Add one below, preview it, then publish.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rules.map(rule => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="space-y-0.5">
                <p className="font-medium">
                  {rule.id} <span className="font-normal text-muted-foreground">· {KIND_LABEL.get(rule.kind)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {rule.keys.length > 0 ? `Keys: ${rule.keys.join(', ')} · ` : ''}window {rule.windowSeconds}s, up to {rule.maxWindowSeconds}s
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={rule.enabled} onChange={e => setRules(rules.map(r => (r.id === rule.id ? { ...r, enabled: e.target.checked } : r)))} />
                    Enabled
                  </label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setRules(rules.filter(r => r.id !== rule.id))}>
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <fieldset className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Add a rule</legend>
          <div className="space-y-1">
            <label htmlFor={`${id}-id`} className="text-sm font-medium">Rule id</label>
            <input id={`${id}-id`} value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} placeholder="db-connection-errors" className={field} />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-kind`} className="text-sm font-medium">Group incidents with</label>
            <select id={`${id}-kind`} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as CorrelationRuleKind })} className={field}>
              {CORRELATION_RULE_KINDS.map(kind => <option key={kind} value={kind}>{KIND_LABEL.get(kind)}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{KIND_HINT.get(draft.kind)}</p>
          </div>
          {draft.kind !== 'CONTENT_TEMPLATE' && (
            <div className="space-y-1 md:col-span-2">
              <label htmlFor={`${id}-keys`} className="text-sm font-medium">Keys</label>
              <input id={`${id}-keys`} value={draft.keys} onChange={e => setDraft({ ...draft, keys: e.target.value })} placeholder="service, env" className={field} />
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor={`${id}-window`} className="text-sm font-medium">Window (seconds)</label>
            <input id={`${id}-window`} type="number" value={draft.windowSeconds} min={MIN_CORRELATION_WINDOW_SECONDS} max={MAX_CORRELATION_WINDOW_SECONDS} onChange={e => setDraft({ ...draft, windowSeconds: Number(e.target.value) })} className={field} />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-max`} className="text-sm font-medium">Maximum window (seconds)</label>
            <input id={`${id}-max`} type="number" value={draft.maxWindowSeconds} min={MIN_CORRELATION_WINDOW_SECONDS} max={MAX_CORRELATION_WINDOW_SECONDS} onChange={e => setDraft({ ...draft, maxWindowSeconds: Number(e.target.value) })} className={field} />
            <p className="text-xs text-muted-foreground">A group stays open while incidents keep arriving, but never longer than this.</p>
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <Button type="button" variant="outline" onClick={addRule}>Add rule</Button>
            {draftError && <p role="alert" className="text-sm text-destructive">{draftError}</p>}
          </div>
        </fieldset>
      )}

      {canManage && (
        <form action={previewAction} className="space-y-3 rounded-md border border-border p-3">
          <input type="hidden" name="rulesJson" value={rulesJson} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor={`${id}-days`} className="text-sm font-medium">Preview on the last (days)</label>
              <input id={`${id}-days`} name="days" type="number" min={1} max={Math.min(90, maxLookbackDays)} value={days} onChange={e => setDays(Number(e.target.value))} className={`${field} w-28`} />
            </div>
            <Button type="submit" variant="outline" disabled={previewing}>{previewing ? 'Replaying…' : 'Preview'}</Button>
          </div>
          {preview.message && <p role={preview.ok ? 'status' : 'alert'} className={preview.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>{preview.message}</p>}
          {p && (
            <div className="space-y-2 text-sm">
              <p>
                Of <strong>{p.incidentsEvaluated}</strong> incidents in the last {p.days} days, <strong>{p.groupedIncidents}</strong> would
                fall into <strong>{p.groups}</strong> groups, proposing <strong>{p.suggestedLinks}</strong> links.
                {p.criticalExcluded > 0 && <> {p.criticalExcluded} critical incidents are excluded and would still page independently.</>}
                {p.truncated && <> Only the most recent incidents were examined.</>}
              </p>
              {p.perRule.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {p.perRule.map(entry => <li key={entry.ruleId}>{entry.ruleId}: {entry.groups} groups, {entry.groupedIncidents} incidents</li>)}
                </ul>
              )}
            </div>
          )}
        </form>
      )}

      {canManage && (
        <form action={publishAction} className="space-y-3">
          <input type="hidden" name="rulesJson" value={rulesJson} />
          <input type="hidden" name="expectedHeadVersion" value={headVersion} />
          <div className="space-y-1">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">Reason (recorded in the audit log)</label>
            <input id={`${id}-reason`} name="reason" maxLength={500} className={field} />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={publishing}>{publishing ? 'Publishing…' : 'Publish rules'}</Button>
            {published.message && <p role={published.ok ? 'status' : 'alert'} className={published.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>{published.message}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
