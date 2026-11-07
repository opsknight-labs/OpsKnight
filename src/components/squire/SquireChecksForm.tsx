'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  deleteCheckTemplateAction,
  saveCheckTemplateAction,
  type CheckTemplateActionState,
} from '@/app/(app)/settings/intelligence/ai/checks-actions';
import type { CheckTemplate } from '@/lib/intelligence/squire/basic/checks';

const idle: CheckTemplateActionState = { message: '', ok: true };

function TemplateForm({
  template,
  canManage,
  onDone,
}: {
  template?: CheckTemplate;
  canManage: boolean;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveCheckTemplateAction, idle);
  return (
    <form action={action} className="grid gap-3 py-3 sm:grid-cols-2">
      {template && <input type="hidden" name="id" value={template.id} />}
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Title</span>
        <input
          name="title"
          required
          maxLength={80}
          defaultValue={template?.title ?? ''}
          disabled={!canManage}
          className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          Title pattern (words, | for alternatives, .* for anything)
        </span>
        <input
          name="pattern"
          required
          maxLength={200}
          defaultValue={template?.pattern ?? ''}
          disabled={!canManage}
          placeholder="pool|too many connections"
          className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          Checks, one per line (up to six)
        </span>
        <textarea
          name="checks"
          required
          rows={3}
          maxLength={1_800}
          defaultValue={template?.checks.join('\n') ?? ''}
          disabled={!canManage}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={template?.enabled ?? true}
          disabled={!canManage}
        />
        Enabled
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          Position (lower matches first)
        </span>
        <input
          type="number"
          name="position"
          min={0}
          max={10000}
          defaultValue={template?.position ?? 100}
          disabled={!canManage}
          className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={!canManage || pending}>
          {template ? 'Save changes' : 'Add template'}
        </Button>
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        {state.message && (
          <span
            role="status"
            className={`text-xs ${state.ok ? 'text-muted-foreground' : 'text-destructive'}`}
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

function DeleteButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteCheckTemplateAction, idle);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="text-destructive"
        disabled={pending}
      >
        Remove
      </Button>
      {state.message && !state.ok && (
        <span role="status" className="text-xs text-destructive">
          {state.message}
        </span>
      )}
    </form>
  );
}

/**
 * The library of "suggested checks" shown with incident answers in basic mode. Built-in templates are
 * listed for reference; administrators add their own, which match first by position.
 */
export default function SquireChecksForm({
  templates,
  canManage,
}: {
  templates: CheckTemplate[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border">
        {templates.map(template => (
          <li key={template.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {template.title}
                  {template.builtIn && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                      Built in
                    </span>
                  )}
                  {!template.enabled && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                      Disabled
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Matches: <code>{template.pattern}</code> · position {template.position}
                </p>
                <ol className="mt-1 list-decimal pl-5 text-xs text-muted-foreground">
                  {template.checks.map(check => (
                    <li key={check}>{check}</li>
                  ))}
                </ol>
              </div>
              {canManage && !template.builtIn && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(template.id)}
                  >
                    Edit
                  </Button>
                  <DeleteButton id={template.id} />
                </div>
              )}
            </div>
            {editing === template.id && (
              <TemplateForm
                template={template}
                canManage={canManage}
                onDone={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>
      {canManage &&
        (adding ? (
          <TemplateForm canManage={canManage} onDone={() => setAdding(false)} />
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add a template
          </Button>
        ))}
    </div>
  );
}
