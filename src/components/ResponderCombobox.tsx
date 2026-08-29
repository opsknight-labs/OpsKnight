'use client';

import { useState } from 'react';
import UserAvatar from '@/components/UserAvatar';
import { Button } from '@/components/ui/shadcn/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Badge } from '@/components/ui/shadcn/badge';
import { Check, ChevronsUpDown, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ResponderOption = {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
  gender?: string | null;
};

type ResponderComboboxProps = {
  users: ResponderOption[];
  onSelect: (userId: string) => void;
  selectedUserId?: string;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  ariaLabel?: string;
};

export default function ResponderCombobox({
  users,
  onSelect,
  selectedUserId,
  disabled = false,
  loading = false,
  label = 'Add Responder',
  placeholder = 'Search by name, email, or role...',
  emptyMessage = 'No active responders match your search.',
  className,
  ariaLabel,
}: ResponderComboboxProps) {
  const [open, setOpen] = useState(false);
  const hasUsers = users.length > 0;
  const isDisabled = disabled || loading || !hasUsers;
  const selectedUser = users.find(user => user.id === selectedUserId);

  return (
    <Popover open={open} onOpenChange={nextOpen => !isDisabled && setOpen(nextOpen)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={
            hasUsers
              ? (ariaLabel ?? (label === 'Add Responder' ? 'Add responder' : label))
              : 'All active responders are already assigned'
          }
          disabled={isDisabled}
          title={hasUsers ? label : 'No active responders available'}
          className={cn(
            'h-9 gap-1.5 border-primary/40 bg-primary/5 px-2.5 text-xs font-medium text-primary hover:border-primary hover:bg-primary/10',
            selectedUser && 'justify-between bg-background text-foreground',
            className
          )}
        >
          {selectedUser ? (
            <>
              <UserAvatar
                userId={selectedUser.id}
                name={selectedUser.name}
                avatarUrl={selectedUser.avatarUrl}
                gender={selectedUser.gender}
                size="sm"
                className="mr-1 h-6 w-6 shrink-0"
              />
              <span className="truncate">{selectedUser.name}</span>
            </>
          ) : (
            <>
              <UserPlus className="h-3.5 w-3.5" />
              {loading ? 'Loading responders…' : hasUsers ? label : 'All Assigned'}
            </>
          )}
          {hasUsers && <ChevronsUpDown className="h-3 w-3 opacity-60" />}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[320px] p-0" align="end" sideOffset={6}>
        <Command className="rounded-lg">
          <CommandInput placeholder={placeholder} aria-label="Search available responders" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty className="px-4 py-8 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </CommandEmpty>
            <CommandGroup heading={`Available responders (${users.length})`} className="p-1.5">
              {users.map(user => (
                <CommandItem
                  key={user.id}
                  value={`${user.name}|${user.email ?? ''}|${user.role ?? ''}|${user.id}`}
                  onSelect={() => {
                    setOpen(false);
                    onSelect(user.id);
                  }}
                  className="my-0.5 cursor-pointer rounded-md px-2 py-2"
                >
                  <UserAvatar
                    userId={user.id}
                    name={user.name}
                    avatarUrl={user.avatarUrl}
                    gender={user.gender}
                    size="sm"
                    className="mr-2 shrink-0 border-slate-200"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-slate-800">
                        {user.name}
                      </span>
                      {user.role && (
                        <Badge variant="secondary" size="xs" className="shrink-0 text-[9px]">
                          {user.role.toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {user.email || 'Active responder'}
                    </span>
                  </div>
                  <Check
                    className={cn(
                      'ml-2 h-4 w-4 shrink-0',
                      user.id === selectedUserId ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
