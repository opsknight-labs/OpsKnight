'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  deleteBudgetAction,
  deleteModelPriceAction,
  saveBudgetAction,
  saveModelPriceAction,
  type CostActionState,
} from '@/app/(app)/settings/intelligence/ai/cost-actions';
import type { AiBudgetView } from '@/lib/intelligence/ai/cost';
import { formatUsd, PROVIDER_KINDS, type ModelPriceOverride } from '@/lib/intelligence/ai/pricing';

const idle: CostActionState = { message: '', ok: true };
const CAPABILITY_OPTIONS = [
  'SQUIRE_CHAT',
  'SUMMARIZE',
  'DIAGNOSE',
  'POSTMORTEM',
  'CLASSIFY',
  'EMBED',
];
const inputClass = 'min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm';
const labelClass = 'mb-1 block text-xs font-medium text-muted-foreground';

function Status({ state }: { state: CostActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`text-sm ${state.ok ? 'text-muted-foreground' : 'text-destructive'}`}
    >
      {state.message}
    </p>
  );
}

function BudgetForm({
  budget,
  teams,
  canManage,
}: {
  budget?: AiBudgetView;
  teams: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveBudgetAction, idle);
  const [scope, setScope] = useState<'TEAM' | 'CAPABILITY'>(budget?.scope ?? 'TEAM');
  return (
    <form action={action} className="grid gap-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="expectedRevision" value={budget?.revision ?? 0} />
      {budget ? (
        <>
          <input type="hidden" name="scope" value={budget.scope} />
          {budget.teamId && <input type="hidden" name="teamId" value={budget.teamId} />}
          {budget.capability && <input type="hidden" name="capability" value={budget.capability} />}
        </>
      ) : (
        <>
          <label className="text-sm">
            <span className={labelClass}>Applies to</span>
            <select
              name="scope"
              value={scope}
              onChange={event => setScope(event.target.value as 'TEAM' | 'CAPABILITY')}
              disabled={!canManage}
              className={inputClass}
            >
              <option value="TEAM">A team</option>
              <option value="CAPABILITY">A capability</option>
            </select>
          </label>
          {scope === 'TEAM' ? (
            <label className="text-sm">
              <span className={labelClass}>Team</span>
              <select name="teamId" required disabled={!canManage} className={inputClass}>
                <option value="">Choose a team</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-sm">
              <span className={labelClass}>Capability</span>
              <select name="capability" required disabled={!canManage} className={inputClass}>
                {CAPABILITY_OPTIONS.map(capability => (
                  <option key={capability} value={capability}>
                    {capability}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <label className="text-sm">
        <span className={labelClass}>Daily tokens (empty: no limit)</span>
        <input
          name="dailyTokenLimit"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          defaultValue={budget?.dailyTokenLimit ?? ''}
          disabled={!canManage}
          className={inputClass}
        />
      </label>
      <label className="text-sm">
        <span className={labelClass}>Daily US dollars (empty: no limit)</span>
        <input
          name="dailyCostLimitUsd"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          defaultValue={
            budget?.dailyCostLimitMicros === null || budget?.dailyCostLimitMicros === undefined
              ? ''
              : budget.dailyCostLimitMicros / 1_000_000
          }
          disabled={!canManage}
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={budget?.enabled ?? true}
          disabled={!canManage}
        />
        Enforced
      </label>
      {canManage && (
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit" disabled={pending}>
            {budget ? 'Save budget' : 'Add budget'}
          </Button>
          <Status state={state} />
        </div>
      )}
    </form>
  );
}

function DeleteBudget({ budget }: { budget: AiBudgetView }) {
  const [state, action, pending] = useActionState(deleteBudgetAction, idle);
  return (
    <form action={action} className="flex items-center gap-3 pb-3">
      <input type="hidden" name="id" value={budget.id} />
      <input type="hidden" name="expectedRevision" value={budget.revision} />
      <Button type="submit" variant="outline" disabled={pending}>
        Remove budget
      </Button>
      <Status state={state} />
    </form>
  );
}

const describeBudget = (budget: AiBudgetView) =>
  [
    budget.dailyTokenLimit !== null
      ? `${budget.dailyTokenLimit.toLocaleString('en-US')} tokens`
      : null,
    budget.dailyCostLimitMicros !== null ? formatUsd(budget.dailyCostLimitMicros) : null,
  ]
    .filter(Boolean)
    .join(' and ') + ' per day';

export function AiBudgetsForm({
  budgets,
  teams,
  canManage,
}: {
  budgets: AiBudgetView[];
  teams: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  return (
    <div className="space-y-2">
      {budgets.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No team or capability budgets. Only the global and per-person token budgets apply.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {budgets.map(budget => (
            <li key={budget.id}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span className="font-medium">
                    {budget.label}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      {budget.scope === 'TEAM' ? 'team' : 'capability'}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {describeBudget(budget)}
                    {budget.enabled ? '' : ' (not enforced)'}
                  </span>
                </summary>
                <BudgetForm budget={budget} teams={teams} canManage={canManage} />
                {canManage && <DeleteBudget budget={budget} />}
              </details>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <details className="border-t border-border">
          <summary className="cursor-pointer py-3 text-sm font-medium">Add a budget</summary>
          <BudgetForm teams={teams} canManage={canManage} />
        </details>
      )}
    </div>
  );
}

export interface ConfiguredModelPrice {
  providerKind: string;
  model: string;
  provider: string;
  inputUsdPerMTok: number | null;
  outputUsdPerMTok: number | null;
  source: 'override' | 'built-in' | null;
}

function PriceForm({ price, canManage }: { price?: ModelPriceOverride; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveModelPriceAction, idle);
  return (
    <form action={action} className="grid gap-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">
        <span className={labelClass}>Provider kind</span>
        <select
          name="providerKind"
          defaultValue={price?.providerKind ?? 'OPENAI'}
          disabled={!canManage || Boolean(price)}
          className={inputClass}
        >
          {PROVIDER_KINDS.map(kind => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        {price && <input type="hidden" name="providerKind" value={price.providerKind} />}
      </label>
      <label className="text-sm">
        <span className={labelClass}>Model (exact id)</span>
        <input
          name="model"
          required
          maxLength={200}
          defaultValue={price?.model ?? ''}
          readOnly={Boolean(price)}
          disabled={!canManage}
          className={inputClass}
        />
      </label>
      <label className="text-sm">
        <span className={labelClass}>Input, USD per million tokens</span>
        <input
          name="inputUsdPerMTok"
          type="number"
          required
          min={0}
          step="0.001"
          inputMode="decimal"
          defaultValue={price?.inputUsdPerMTok ?? ''}
          disabled={!canManage}
          className={inputClass}
        />
      </label>
      <label className="text-sm">
        <span className={labelClass}>Output, USD per million tokens</span>
        <input
          name="outputUsdPerMTok"
          type="number"
          min={0}
          step="0.001"
          inputMode="decimal"
          defaultValue={price?.outputUsdPerMTok ?? ''}
          disabled={!canManage}
          className={inputClass}
        />
      </label>
      {canManage && (
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={pending}>
            {price ? 'Save price' : 'Add price'}
          </Button>
          <Status state={state} />
        </div>
      )}
    </form>
  );
}

function DeletePrice({ price }: { price: ModelPriceOverride }) {
  const [state, action, pending] = useActionState(deleteModelPriceAction, idle);
  return (
    <form action={action} className="flex items-center gap-3 pb-3">
      <input type="hidden" name="providerKind" value={price.providerKind} />
      <input type="hidden" name="model" value={price.model} />
      <Button type="submit" variant="outline" disabled={pending}>
        Use the built-in price
      </Button>
      <Status state={state} />
    </form>
  );
}

const perMillion = (value: number | null) =>
  value === null ? 'unpriced' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;

export function AiModelPricesForm({
  configured,
  overrides,
  canManage,
}: {
  configured: ConfiguredModelPrice[];
  overrides: ModelPriceOverride[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-3">
      {configured.length > 0 && (
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Prices used for configured models</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 font-medium">
                Model
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Input / 1M
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Output / 1M
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {configured.map(row => (
              <tr key={`${row.provider}:${row.model}`} className="border-t border-border">
                <td className="py-1">
                  {row.model} <span className="text-muted-foreground">· {row.provider}</span>
                </td>
                <td className="py-1 text-right">{perMillion(row.inputUsdPerMTok)}</td>
                <td className="py-1 text-right">{perMillion(row.outputUsdPerMTok)}</td>
                <td className="py-1 text-right">
                  {row.source === 'override'
                    ? 'Your price'
                    : row.source === 'built-in'
                      ? 'List price'
                      : 'None'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {overrides.length > 0 && (
        <ul className="divide-y divide-border">
          {overrides.map(price => (
            <li key={`${price.providerKind}:${price.model}`}>
              <details>
                <summary className="cursor-pointer py-3 text-sm">
                  <span className="font-medium">{price.model}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    {price.providerKind} · {perMillion(price.inputUsdPerMTok)} in /{' '}
                    {perMillion(price.outputUsdPerMTok)} out
                  </span>
                </summary>
                <PriceForm price={price} canManage={canManage} />
                {canManage && <DeletePrice price={price} />}
              </details>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <details className="border-t border-border">
          <summary className="cursor-pointer py-3 text-sm font-medium">Set a price</summary>
          <PriceForm canManage={canManage} />
        </details>
      )}
    </div>
  );
}
