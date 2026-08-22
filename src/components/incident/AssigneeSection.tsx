'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reassignIncident } from '@/app/(app)/incidents/actions';
import { useToast } from '../ToastProvider';
import UserAvatar from '@/components/UserAvatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Button } from '@/components/ui/shadcn/button';
import { Check, ChevronsUpDown, Users as UsersIcon, User, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type AssigneeSectionProps = {
  assignee: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  team: { id: string; name: string } | null;
  assigneeId: string | null;
  teamId: string | null;
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
    role?: string;
  }>;
  teams: Array<{ id: string; name: string }>;
  incidentId: string;
  canManage: boolean;
  variant?: 'list' | 'detail' | 'header';
};

export default function AssigneeSection({
  assignee,
  team,
  assigneeId,
  teamId,
  users,
  teams = [],
  incidentId,
  canManage,
  variant = 'list',
}: AssigneeSectionProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleReassign = async (value: string) => {
    // Value format: "user:id", "team:id", or ""
    startTransition(async () => {
      try {
        let newAssigneeId = '';
        let newTeamId = '';

        if (value.startsWith('user:')) {
          newAssigneeId = value.substring(5);
        } else if (value.startsWith('team:')) {
          newTeamId = value.substring(5);
        }

        await reassignIncident(incidentId, newAssigneeId, newTeamId);
        showToast(
          value ? 'Incident reassigned successfully' : 'Incident unassigned successfully',
          'success'
        );
        setOpen(false);
        router.refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to reassign', 'error');
      }
    });
  };

  const currentValue = teamId ? `team:${teamId}` : assigneeId ? `user:${assigneeId}` : '';

  // Generic Reassign Content (Shared)
  const ReassignContent = (
    <Command className="rounded-lg border shadow-md">
      <CommandInput placeholder="Search assignee..." className="border-none focus:ring-0" />
      <CommandList className="max-h-[300px]">
        <CommandEmpty className="py-6 text-center text-sm">No results found.</CommandEmpty>

        <CommandGroup heading="Actions" className="p-1.5">
          <CommandItem
            value="unassign"
            onSelect={() => handleReassign('')}
            className="text-sm rounded-md aria-selected:bg-accent"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 mr-2 border">
              <X className="h-4 w-4 text-slate-500" />
            </div>
            <span>Unassigned</span>
            <Check
              className={cn(
                'ml-auto h-4 w-4 text-primary',
                currentValue === '' ? 'opacity-100' : 'opacity-0'
              )}
            />
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Teams" className="p-1.5">
          {teams.map(t => (
            <CommandItem
              key={t.id}
              value={`team:${t.id}|${t.name}`} // Include name for better search
              onSelect={() => handleReassign(`team:${t.id}`)}
              className="text-sm rounded-md aria-selected:bg-accent my-0.5"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center mr-2 border border-indigo-200">
                <UsersIcon className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="flex flex-col">
                <span className="font-medium">{t.name}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Team
                </span>
              </div>
              <Check
                className={cn(
                  'ml-auto h-4 w-4 text-primary',
                  currentValue === `team:${t.id}` ? 'opacity-100' : 'opacity-0'
                )}
              />
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Users" className="p-1.5">
          {users.map(u => (
            <CommandItem
              key={u.id}
              value={`user:${u.id}|${u.name}|${u.email}`} // Include name/email for search
              onSelect={() => handleReassign(`user:${u.id}`)}
              className="text-sm rounded-md aria-selected:bg-accent my-0 py-1.5"
            >
              <UserAvatar
                userId={u.id}
                name={u.name}
                gender={u.gender}
                avatarUrl={u.avatarUrl}
                size="sm"
                className="mr-2 border-slate-200"
              />
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate text-xs">{u.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>
              </div>
              <Check
                className={cn(
                  'ml-auto h-4 w-4 text-primary shrink-0',
                  currentValue === `user:${u.id}` ? 'opacity-100' : 'opacity-0'
                )}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  // Header Variant - Button Trigger
  if (variant === 'header') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-6 w-6 p-0 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-500 hover:text-slate-900 shrink-0"
            disabled={!canManage}
            title="Change Assignee"
          >
            <ChevronsUpDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-64" align="end">
          {ReassignContent}
        </PopoverContent>
      </Popover>
    );
  }

  // List/Detail Variant - Display as Card/Row Item
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!canManage}>
        <div
          data-no-row-nav="true"
          onClick={e => e.stopPropagation()}
          className={cn(
            'flex items-center gap-2 px-2 py-1 -ml-2 rounded-md transition-colors',
            canManage ? 'cursor-pointer hover:bg-slate-100/50' : 'cursor-default'
          )}
          role="button"
          tabIndex={canManage ? 0 : -1}
        >
          {assignee ? (
            <>
              <UserAvatar
                userId={assignee.id}
                name={assignee.name}
                gender={assignee.gender}
                avatarUrl={assignee.avatarUrl}
                size="xs"
                className="border-slate-200"
              />
              <span className="text-sm font-medium text-slate-700 truncate max-w-[120px]">
                {assignee.name.split(' ')[0]}
              </span>
            </>
          ) : team ? (
            <>
              <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200">
                <UsersIcon className="h-3 w-3 text-indigo-600" />
              </div>
              <span className="text-sm font-medium text-slate-700 truncate max-w-[120px]">
                {team.name}
              </span>
            </>
          ) : (
            <>
              <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-400">
                <User className="h-3 w-3" />
              </div>
              <span className="text-sm italic text-slate-500">Unassigned</span>
            </>
          )}
        </div>
      </PopoverTrigger>
      {canManage && (
        <PopoverContent className="p-0 w-64" align="start">
          {ReassignContent}
        </PopoverContent>
      )}
    </Popover>
  );
}
