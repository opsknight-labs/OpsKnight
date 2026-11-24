'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { ActionMessage, fieldClass, labelClass } from '@/components/settings/form-kit';
import {
  addDocSourceAction,
  deleteDocSourceAction,
  syncDocSourceAction,
  type DocSourceActionState,
} from './actions';

const initial: DocSourceActionState = { message: '', ok: false };

export function AddDocSourceForm({ teams }: { teams: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(addDocSourceAction, initial);
  const id = useId();
  const field = (name: string, label: string, hint?: string, type = 'text') => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${name}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        name={name}
        type={type}
        autoComplete="off"
        className={fieldClass}
        disabled={pending}
        aria-describedby={hint ? `${id}-${name}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
  return (
    <form action={action} className="grid gap-3 py-3 sm:grid-cols-2">
      {field('name', 'Name')}
      <div className="space-y-1">
        <label htmlFor={`${id}-kind`} className={labelClass}>
          Kind
        </label>
        <select id={`${id}-kind`} name="kind" className={fieldClass} disabled={pending}>
          <option value="GIT">Git repository (GitHub or GitLab)</option>
          <option value="ARCHIVE">Archive URL (.tar.gz)</option>
        </select>
      </div>
      {field(
        'url',
        'Address',
        'https only. A repository page such as https://github.com/acme/runbooks, or a .tar.gz link.'
      )}
      {field('ref', 'Branch or tag', 'Git only. Empty for the default branch.')}
      {field(
        'path',
        'Folder',
        'Only .md, .mdx and .txt files under this folder are read. Empty for everything.'
      )}
      {field(
        'token',
        'Access token',
        'Optional, for a private repository. Read-only scope is enough; stored encrypted.',
        'password'
      )}
      <div className="space-y-1">
        <label htmlFor={`${id}-team`} className={labelClass}>
          Readers
        </label>
        <select id={`${id}-team`} name="teamId" className={fieldClass} disabled={pending}>
          <option value="">Everyone signed in</option>
          {teams.map(team => (
            <option key={team.id} value={team.id}>
              {team.name} only
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Adding…' : 'Add source'}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

export function DocSourceButtons({ id, name }: { id: string; name: string }) {
  const [syncState, sync, syncing] = useActionState(syncDocSourceAction, initial);
  const [deleteState, remove, deleting] = useActionState(deleteDocSourceAction, initial);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={sync}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="outline" disabled={syncing || deleting}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </form>
        <DeleteConfirmDialog
          title={`Remove ${name}?`}
          description="Squire stops using this source immediately and everything indexed from it is deleted."
          confirmText="Remove source"
          disabled={syncing || deleting}
          trigger={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={syncing || deleting}
              aria-label={`Remove ${name}`}
            >
              Remove
            </Button>
          }
          onConfirm={() => {
            const data = new FormData();
            data.set('id', id);
            remove(data);
          }}
        />
      </div>
      <ActionMessage state={syncState} />
      <ActionMessage state={deleteState} />
    </div>
  );
}
