'use client';

import { Check } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';

export type IncidentPickerUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  gender?: string | null;
};

/** Searchable teammate list shared by the watcher and incident-role pickers. */
export default function IncidentUserPicker({
  users,
  selectedUserId,
  onSelect,
  placeholder = 'Search teammates...',
  emptyText = 'No available teammates found.',
}: {
  users: IncidentPickerUser[];
  selectedUserId?: string | null;
  onSelect: (user: IncidentPickerUser) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  return (
    <Command className="rounded-lg">
      <CommandInput placeholder={placeholder} className="h-8 text-xs border-none focus:ring-0" />
      <CommandList className="max-h-48">
        <CommandEmpty className="py-4 text-center text-xs text-ink-400">{emptyText}</CommandEmpty>
        <CommandGroup className="p-1">
          {users.map(user => (
            <CommandItem
              key={user.id}
              value={`${user.name}|${user.email}`}
              onSelect={() => onSelect(user)}
              className="flex items-center gap-2 cursor-pointer text-xs rounded-md py-1.5"
            >
              <UserAvatar
                userId={user.id}
                name={user.name}
                gender={user.gender}
                avatarUrl={user.avatarUrl}
                size="xs"
                className="shrink-0"
                aria-hidden
              />
              <div className="flex flex-col min-w-0">
                <span className="font-semibold truncate text-xs">{user.name}</span>
                <span className="text-[10px] text-ink-400 truncate">{user.email}</span>
              </div>
              <Check
                className={cn(
                  'ml-auto h-3.5 w-3.5 text-primary shrink-0',
                  selectedUserId === user.id ? 'opacity-100' : 'opacity-0'
                )}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
