'use client';

import { useActionState, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Archive } from 'lucide-react';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { saveObjective } from '@/app/(app)/settings/service-objectives/actions';
import { SearchableRunbookSelect } from '@/components/runbooks/SearchableRunbookSelect';
import { SERVICE_OBJECTIVE_CONTRACT } from '@/lib/slo/contract';
import { formatObjectiveWindow } from '@/components/settings/serviceObjectiveSummary';

type Definition = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  target: number;
  comparator: string;
  windowType: string;
  windowValue: number | null;
};

// Native select styled like the shadcn Input so the form reads as one control set.
const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-hint`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function ServiceObjectiveForm({
  objective,
  archive = false,
  onSaved,
  onCancel,
}: {
  objective?: Definition;
  archive?: boolean;
  /** Called after a successful save or archive (e.g. to close the surrounding panel). */
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState(saveObjective, { message: '', ok: false });
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [windowType, setWindowType] = useState(objective?.windowType ?? 'THIRTY_DAYS');
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.ok && state.message) {
      notify.success(state.message);
      onSaved?.();
    }
  }, [state, onSaved]);

  // Inline validation: show the browser's constraint message under the field instead of a bubble.
  const onInvalid = (event: FormEvent<HTMLFormElement>) => {
    const field = event.target as HTMLInputElement;
    if (!field.name) return;
    event.preventDefault();
    setErrors(current => new Map(current).set(field.name, field.validationMessage));
  };
  const clearError = (event: FormEvent<HTMLFormElement>) => {
    const { name } = event.target as HTMLInputElement;
    if (!name || !errors.has(name)) return;
    setErrors(current => {
      const next = new Map(current);
      next.delete(name);
      return next;
    });
  };
  const id = (name: string) => `${prefix}-${name}`;
  const describe = (key: string, name = key) => ({
    'aria-describedby': `${id(key)}-hint`,
    'aria-invalid': errors.has(name) || undefined,
  });

  return (
    <form
      ref={formRef}
      action={action}
      onInvalidCapture={onInvalid}
      onInputCapture={clearError}
      className={archive ? 'inline-flex flex-col items-end gap-1' : 'space-y-4'}
    >
      <input
        type="hidden"
        name="operation"
        value={archive ? 'archive' : objective ? 'update' : 'create'}
      />
      {objective && (
        <>
          <input type="hidden" name="id" value={objective.id} />
          <input type="hidden" name="version" value={objective.version} />
        </>
      )}
      {!archive && (
        <fieldset disabled={pending} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {!objective && (
            <>
              <SearchableRunbookSelect
                kind="service"
                name="serviceId"
                label="Service (required for uptime and availability)"
              />
              <Field
                id={id('metric')}
                label="Measurement"
                hint="Uptime and availability use percent; MTTA and MTTR use minutes."
              >
                <select
                  className={selectClass}
                  id={id('metric')}
                  name="metricType"
                  {...describe('metric')}
                >
                  {SERVICE_OBJECTIVE_CONTRACT.metrics.map(metric => (
                    <option key={metric.id} value={metric.id}>
                      {metric.id} ({metric.unit})
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field
            id={id('name')}
            label="Name"
            hint="Up to 100 characters."
            error={errors.get('name')}
            className="md:col-span-2"
          >
            <Input
              id={id('name')}
              name="name"
              required
              maxLength={100}
              placeholder="e.g. Checkout API uptime"
              defaultValue={objective?.name}
              {...describe('name')}
            />
          </Field>
          <Field
            id={id('description')}
            label="Description"
            hint="Optional. Up to 500 characters."
            className="md:col-span-2"
          >
            <Textarea
              id={id('description')}
              name="description"
              maxLength={500}
              rows={2}
              defaultValue={objective?.description ?? ''}
              {...describe('description')}
            />
          </Field>
          <Field id={id('comparator')} label="Comparison">
            <select
              className={selectClass}
              id={id('comparator')}
              name="comparator"
              defaultValue={objective?.comparator ?? 'GREATER_THAN_OR_EQUAL'}
            >
              <option value="GREATER_THAN_OR_EQUAL">At least</option>
              <option value="LESS_THAN_OR_EQUAL">At most</option>
            </select>
          </Field>
          <Field
            id={id('target')}
            label="Target"
            hint="Percent for uptime and availability, minutes for MTTA and MTTR."
            error={errors.get('target')}
          >
            <Input
              id={id('target')}
              name="target"
              type="number"
              min="0"
              step="any"
              required
              inputMode="decimal"
              defaultValue={objective?.target ?? 99.9}
              {...describe('target')}
            />
          </Field>
          <Field
            id={id('window')}
            label="Window"
            hint="Elapsed rolling days, not calendar periods."
          >
            <select
              className={selectClass}
              id={id('window')}
              name="windowType"
              value={windowType}
              onChange={event => setWindowType(event.target.value)}
              {...describe('window')}
            >
              {SERVICE_OBJECTIVE_CONTRACT.windows.map(window => (
                <option key={window} value={window}>
                  {formatObjectiveWindow(window, null)}
                </option>
              ))}
            </select>
          </Field>
          {windowType === 'ROLLING_DAYS' && (
            <Field
              id={id('days')}
              label="Days"
              hint={`Between ${SERVICE_OBJECTIVE_CONTRACT.rollingDays.minimum} and ${SERVICE_OBJECTIVE_CONTRACT.rollingDays.maximum}.`}
              error={errors.get('windowValue')}
            >
              <Input
                id={id('days')}
                name="windowValue"
                type="number"
                min="1"
                max="3650"
                step="1"
                required
                inputMode="numeric"
                defaultValue={objective?.windowValue ?? 30}
                {...describe('days', 'windowValue')}
              />
            </Field>
          )}
        </fieldset>
      )}
      {archive ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={pending}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            aria-label="Archive objective"
            title="Archive objective: retires the active definition; versions and measurements stay available through the API"
            onClick={() => setConfirmArchive(true)}
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
          </Button>
          <DeleteConfirmDialog
            open={confirmArchive}
            onOpenChange={setConfirmArchive}
            title={`Archive "${objective?.name ?? 'objective'}"?`}
            description="The objective stops being evaluated and disappears from this list. Earlier versions and measurements stay available through the API."
            confirmText="Archive objective"
            onConfirm={() => formRef.current?.requestSubmit()}
          />
        </>
      ) : (
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          {onCancel && (
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" loading={pending}>
            {objective ? 'Save new version' : 'Create objective'}
          </Button>
        </div>
      )}
      {state.message && !state.ok && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
