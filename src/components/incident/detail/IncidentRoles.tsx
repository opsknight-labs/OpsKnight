'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, UserCheck, UserMinus, Users } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/shadcn/hover-card';
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
  /** Major incidents (P1/P2) show every role up front; others start with the commander only. */
  showAllRoles?: boolean;
};

/** Roles strip in the incident hero: one slot per catalog role, assign/take/clear in place. */
export default function IncidentRoles({
  roles,
  users,
  currentUserId,
  onSetRole,
  showAllRoles = false,
}: IncidentRolesProps) {
  const [expanded, setExpanded] = useState(showAllRoles);
  // Commander always; any role someone holds; the rest fold into one "+ N roles" chip.
  const visible = expanded
    ? roles
    : roles.filter(role => role.roleKey === 'COMMANDER' || role.holder);
  const folded = roles.filter(role => !visible.includes(role));
  const canFill = folded.some(role => role.canAssignOthers || role.canTakeSelf);

  return (
    <section aria-label="Incident roles" className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Roles
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {visible.map(role => (
          <li key={role.roleKey} className="min-w-0 max-w-60">
            <RoleSlot
              role={role}
              users={users}
              currentUserId={currentUserId}
              onSetRole={onSetRole}
            />
          </li>
        ))}
        {folded.length > 0 && canFill && (
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title={folded.map(role => role.label).join(', ')}
              aria-label={`Show more roles: ${folded.map(role => role.label).join(', ')}`}
              className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-dashed border-border/80 px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {folded.length} more {folded.length === 1 ? 'role' : 'roles'}
              </span>
            </button>
          </li>
        )}
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
  const [hoverOpen, setHoverOpen] = useState(false);
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
      ) : isPending ? (
        <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Plus aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      {/* One line: role, then holder. Why the role exists lives in the hover card and the picker. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left leading-tight">
        <span
          className={cn(
            'shrink-0 text-muted-foreground',
            holder ? 'text-2xs font-semibold' : 'text-xs font-medium'
          )}
        >
          {role.shortLabel}
        </span>
        <span
          className={cn(
            'truncate text-xs',
            holder ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
            !holder && 'sr-only'
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
    'flex w-full min-w-0 items-center border text-left transition-colors',
    'h-8 gap-1.5 rounded-md pr-2.5',
    holder ? 'pl-1' : 'pl-2.5',
    holder ? 'border-border bg-background' : 'border-dashed border-border/80 bg-muted/20'
  );

  const details = (
    <HoverCardContent align="start" className="w-72 p-0">
      <div className="space-y-1 px-3 py-2.5">
        <p className="text-xs font-semibold text-foreground">{role.label}</p>
        <p className="text-xs leading-snug text-muted-foreground">{role.description}</p>
      </div>
      <div className="flex items-center gap-2.5 border-t border-border px-3 py-2.5">
        {holder ? (
          <>
            <UserAvatar
              userId={holder.id}
              name={holder.name}
              gender={holder.gender}
              avatarUrl={holder.avatarUrl}
              size="sm"
              className="shrink-0"
              aria-hidden
            />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-xs font-semibold text-foreground">
                {holder.name}
                {isMine ? ' (you)' : ''}
              </span>
              <span className="block truncate text-2xs text-muted-foreground">{holder.email}</span>
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Nobody holds this role yet.</span>
        )}
      </div>
      {interactive && (
        <p className="border-t border-border bg-muted/30 px-3 py-1.5 text-2xs text-muted-foreground">
          {holder
            ? 'Click to change or clear'
            : canTake
              ? 'Click to take it or assign someone'
              : 'Click to assign someone'}
        </p>
      )}
    </HoverCardContent>
  );

  if (!interactive) {
    return (
      <HoverCard openDelay={250} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className={slotClass} tabIndex={0}>
            {body}
          </div>
        </HoverCardTrigger>
        {details}
      </HoverCard>
    );
  }

  const others = users.filter(user => user.id !== holder?.id);
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) setHoverOpen(false);
      }}
    >
      {/* Hover shows who holds the role and why it exists; it stays shut while the picker is open. */}
      <HoverCard
        open={hoverOpen && !open}
        onOpenChange={setHoverOpen}
        openDelay={250}
        closeDelay={100}
      >
        <HoverCardTrigger asChild>
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
        </HoverCardTrigger>
        {details}
      </HoverCard>
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
