'use client';

import { useState } from 'react';
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
import { Check, ChevronsUpDown, Users, Calendar, Search } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';

export type UserTargetOption = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  gender?: string | null;
};

export type GenericTargetOption = {
  id: string;
  name: string;
};

type PolicyTargetComboboxProps = {
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  name: string;
  users?: UserTargetOption[];
  teams?: GenericTargetOption[];
  schedules?: GenericTargetOption[];
  selectedValue?: string;
  onSelect?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

export default function PolicyTargetCombobox({
  targetType,
  name,
  users = [],
  teams = [],
  schedules = [],
  selectedValue,
  onSelect,
  disabled = false,
  required = false,
  className,
}: PolicyTargetComboboxProps) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(
    selectedValue ||
      (targetType === 'USER'
        ? users[0]?.id
        : targetType === 'TEAM'
          ? teams[0]?.id
          : schedules[0]?.id) ||
      ''
  );

  const currentValue = selectedValue !== undefined ? selectedValue : internalValue;

  const handleSelect = (val: string) => {
    setInternalValue(val);
    if (onSelect) onSelect(val);
    setOpen(false);
  };

  // Find currently selected entity
  const selectedUser = targetType === 'USER' ? users.find(u => u.id === currentValue) : null;
  const selectedTeam = targetType === 'TEAM' ? teams.find(t => t.id === currentValue) : null;
  const selectedSchedule =
    targetType === 'SCHEDULE' ? schedules.find(s => s.id === currentValue) : null;

  return (
    <div className="relative">
      <input type="hidden" name={name} value={currentValue} required={required} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'w-full justify-between h-9 text-xs font-normal bg-white border-slate-200 hover:border-primary/50 hover:bg-slate-50/50',
              !currentValue && 'text-muted-foreground',
              className
            )}
          >
            {targetType === 'USER' &&
              (selectedUser ? (
                <div className="flex items-center gap-2 truncate">
                  <UserAvatar
                    userId={selectedUser.id}
                    name={selectedUser.name}
                    gender={selectedUser.gender}
                    size="xs"
                    className="shrink-0"
                  />
                  <span className="font-medium truncate">{selectedUser.name}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    ({selectedUser.email})
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 opacity-50" /> Select a user...
                </span>
              ))}

            {targetType === 'TEAM' &&
              (selectedTeam ? (
                <div className="flex items-center gap-2 truncate">
                  <div className="w-5 h-5 rounded-md bg-purple-50 flex items-center justify-center text-purple-600 shrink-0 border border-purple-100">
                    <Users className="h-3 w-3" />
                  </div>
                  <span className="font-medium truncate">{selectedTeam.name}</span>
                </div>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 opacity-50" /> Select a team...
                </span>
              ))}

            {targetType === 'SCHEDULE' &&
              (selectedSchedule ? (
                <div className="flex items-center gap-2 truncate">
                  <div className="w-5 h-5 rounded-md bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0 border border-emerald-100">
                    <Calendar className="h-3 w-3" />
                  </div>
                  <span className="font-medium truncate">{selectedSchedule.name}</span>
                </div>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 opacity-50" /> Select an on-call schedule...
                </span>
              ))}

            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput
              placeholder={
                targetType === 'USER'
                  ? 'Search user by name or email...'
                  : targetType === 'TEAM'
                    ? 'Search team name...'
                    : 'Search on-call schedule...'
              }
              className="text-xs h-9"
            />
            <CommandList className="max-h-[220px]">
              <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                {targetType === 'USER'
                  ? 'No users found matching query.'
                  : targetType === 'TEAM'
                    ? 'No teams found matching query.'
                    : 'No schedules found matching query.'}
              </CommandEmpty>

              {targetType === 'USER' && (
                <CommandGroup>
                  {users.map(user => (
                    <CommandItem
                      key={user.id}
                      value={`${user.name} ${user.email}`}
                      onSelect={() => handleSelect(user.id)}
                      className="text-xs flex items-center justify-between cursor-pointer py-2"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <UserAvatar
                          userId={user.id}
                          name={user.name}
                          gender={user.gender}
                          size="xs"
                          className="shrink-0"
                        />
                        <div className="flex flex-col truncate">
                          <span className="font-medium truncate">{user.name}</span>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {user.email}
                          </span>
                        </div>
                      </div>
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0 text-primary',
                          currentValue === user.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {targetType === 'TEAM' && (
                <CommandGroup>
                  {teams.map(team => (
                    <CommandItem
                      key={team.id}
                      value={team.name}
                      onSelect={() => handleSelect(team.id)}
                      className="text-xs flex items-center justify-between cursor-pointer py-2"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <div className="w-5 h-5 rounded-md bg-purple-50 flex items-center justify-center text-purple-600 shrink-0 border border-purple-100">
                          <Users className="h-3 w-3" />
                        </div>
                        <span className="font-medium truncate">{team.name}</span>
                      </div>
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0 text-primary',
                          currentValue === team.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {targetType === 'SCHEDULE' && (
                <CommandGroup>
                  {schedules.map(schedule => (
                    <CommandItem
                      key={schedule.id}
                      value={schedule.name}
                      onSelect={() => handleSelect(schedule.id)}
                      className="text-xs flex items-center justify-between cursor-pointer py-2"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <div className="w-5 h-5 rounded-md bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0 border border-emerald-100">
                          <Calendar className="h-3 w-3" />
                        </div>
                        <span className="font-medium truncate">{schedule.name}</span>
                      </div>
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0 text-primary',
                          currentValue === schedule.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
