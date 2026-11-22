'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, UserCheck, UserMinus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Button } from '@/components/ui/shadcn/button';
import UserAvatar from '@/components/UserAvatar';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { IncidentRoleKey } from '@/lib/incidents/roles';
import IncidentUserPicker, { type IncidentPickerUser } from './IncidentUserPicker';

export type IncidentRoleSlot = {
  roleKey: IncidentRoleKey;
  label: string;
  shortLabel: string;
  description: string;
  holder: IncidentPickerUser | null;
  canAssignOthers: boolean;
  canTakeSelf: boolean;
  canClear: boolean;
};

type IncidentRolesProps = {
  roles: IncidentRoleSlot[];
  users: IncidentPickerUser[];
  currentUserId: string;
  onSetRole: (roleKey: IncidentRoleKey, userId: string | null) => Promise<unknown>;
  presentation?: 'desktop' | 'mobile';
};

/** Roles strip in the incident hero: one slot per catalog role, assign/take/clear in place. */
export default function IncidentRoles({
  roles,
  users,
  currentUserId,
  onSetRole,
  presentation = 'desktop',
}: IncidentRolesProps) {
  return (
    <section aria-label="Incident roles">
      <ul
        className={cn(
          'grid gap-2',
          presentation === 'mobile' ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'
        )}
      >
        {roles.map(role => (
          <li key={role.roleKey} className="min-w-0">
            <RoleSlot
              role={role}
              users={users}
              currentUserId={currentUserId}
              onSetRole={onSetRole}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleSlot({
  role,
  users,
  currentUserId,
  onSetRole,
}: {
  role: IncidentRoleSlot;
  users: IncidentPickerUser[];
  currentUserId: string;
  onSetRole: IncidentRolesProps['onSetRole'];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const holder = role.holder;
  const isMine = holder?.id === currentUserId;
  const canTake = role.canTakeSelf && !isMine;
  const interactive = role.canAssignOthers || canTake || role.canClear;

  const change = (userId: string | null) => {
    setOpen(false);
    startTransition(async () => {
      try {
        await onSetRole(role.roleKey, userId);
        router.refresh();
      } catch (error) {
        notify.error(error instanceof Error ? error.message : `Could not update ${role.label}`);
      }
    });
  };

  const body = (
    <>
      {holder ? (
        <UserAvatar
          userId={holder.id}
          name={holder.name}
          gender={holder.gender}
          avatarUrl={holder.avatarUrl}
          size="xs"
          className="shrink-0"
          aria-hidden
        />
      ) : (
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        </span>
      )}
      <span className="flex min-w-0 flex-col text-left leading-tight">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {role.shortLabel}
        </span>
        <span
          className={cn(
            'truncate text-xs',
            holder ? 'font-medium text-foreground' : 'text-muted-foreground'
          )}
        >
          {holder
            ? isMine
              ? `${holder.name} (you)`
              : holder.name
            : interactive
              ? 'Assign'
              : 'Unassigned'}
        </span>
      </span>
      {holder && isPending && (
        <Loader2
          aria-hidden
          className="ml-auto h-3 w-3 shrink-0 animate-spin text-muted-foreground"
        />
      )}
    </>
  );

  const slotClass = cn(
    'flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors',
    holder ? 'border-border bg-background' : 'border-dashed border-border/80 bg-muted/20'
  );

  if (!interactive) {
    return (
      <div className={slotClass} title={role.description}>
        {body}
      </div>
    );
  }

  const others = users.filter(user => user.id !== holder?.id);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          aria-label={`${role.label}: ${holder ? holder.name : 'unassigned'}. Change`}
          className={cn(
            slotClass,
            'hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'
          )}
        >
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" aria-label={`${role.label} role`}>
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-xs font-semibold text-foreground">{role.label}</p>
          <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">{role.description}</p>
        </div>
        {(canTake || role.canClear) && (
          <div className="flex flex-col gap-0.5 border-b border-border p-1">
            {canTake && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
                onClick={() => change(currentUserId)}
              >
                <UserCheck className="h-3.5 w-3.5" aria-hidden />
                {role.roleKey === 'COMMANDER' ? 'Take command' : 'Assign to me'}
              </Button>
            )}
            {role.canClear && holder && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-start gap-2 text-xs text-muted-foreground"
                onClick={() => change(null)}
              >
                <UserMinus className="h-3.5 w-3.5" aria-hidden />
                {isMine ? 'Step down' : 'Clear role'}
              </Button>
            )}
          </div>
        )}
        {role.canAssignOthers && (
          <IncidentUserPicker
            users={others}
            selectedUserId={holder?.id}
            onSelect={user => change(user.id)}
            placeholder={`Assign ${role.shortLabel.toLowerCase()}...`}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
