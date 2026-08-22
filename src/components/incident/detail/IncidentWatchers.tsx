'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Users, Lock, Trash2, Check, ChevronsUpDown, Search } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';

type Watcher = {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  };
  role: string;
};

type IncidentWatchersProps = {
  watchers: Watcher[];
  // Updated type to include avatar/gender for selection list
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  canManage: boolean;
  onAddWatcher: (formData: FormData) => void;
  onRemoveWatcher: (formData: FormData) => void;
};

export default function IncidentWatchers({
  watchers,
  users,
  canManage,
  onAddWatcher,
  onRemoveWatcher,
}: IncidentWatchersProps) {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  const selectedUser = users.find(u => u.id === selectedUserId);

  // Filter out users who are already watchers to keep the list clean (optional, but good UX)
  // Or just mark them. Let's keep them but maybe disable? no, just simple select for now.
  const availableUsers = users.filter(u => !watchers.some(w => w.user.id === u.id));

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center px-1">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Watchers
        </h4>
        <Badge variant="outline" size="xs" className="text-muted-foreground">
          Visibility
        </Badge>
      </div>

      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-4 space-y-4">
          {canManage ? (
            <form
              action={formData => {
                // Reset selection after submit (optimistic)
                // Ideally we'd wait for result, but for now simple reset
                const res = onAddWatcher(formData);
                setSelectedUserId('');
                return res;
              }}
              className="grid gap-3"
            >
              <div className="flex flex-wrap gap-2">
                {/* Searchable User Select (Combobox) */}
                <input type="hidden" name="watcherId" value={selectedUserId} />

                <div className="flex-1 min-w-[140px]">
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-full justify-between h-9 text-sm bg-background px-3 font-normal"
                      >
                        {selectedUser ? (
                          <div className="flex items-center gap-2 overflow-hidden">
                            <UserAvatar
                              userId={selectedUser.id}
                              name={selectedUser.name}
                              gender={selectedUser.gender}
                              avatarUrl={selectedUser.avatarUrl}
                              size="xs"
                              className="shrink-0"
                            />
                            <span className="truncate">{selectedUser.name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground truncate">Select user...</span>
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-0 border shadow-md rounded-lg w-[320px]"
                      align="start"
                    >
                      <Command className="rounded-lg">
                        <CommandInput
                          placeholder="Search user..."
                          className="border-none focus:ring-0"
                        />
                        <CommandList className="max-h-[300px]">
                          <CommandEmpty className="py-6 text-center text-sm">
                            No user found.
                          </CommandEmpty>
                          <CommandGroup className="p-1.5">
                            {availableUsers.map(user => (
                              <CommandItem
                                key={user.id}
                                value={`${user.name}|${user.email}`}
                                onSelect={() => {
                                  setSelectedUserId(user.id);
                                  setOpen(false);
                                }}
                                className="flex items-center gap-2 cursor-pointer text-sm rounded-md aria-selected:bg-accent my-0 py-1.5"
                              >
                                <UserAvatar
                                  userId={user.id}
                                  name={user.name}
                                  gender={user.gender}
                                  avatarUrl={user.avatarUrl}
                                  size="sm"
                                  className="border-slate-200"
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium leading-none truncate text-xs">
                                    {user.name}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground truncate">
                                    {user.email}
                                  </span>
                                </div>
                                <Check
                                  className={cn(
                                    'ml-auto h-4 w-4 text-primary shrink-0',
                                    selectedUserId === user.id ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="w-[110px] shrink-0">
                  <Select name="watcherRole" defaultValue="FOLLOWER">
                    <SelectTrigger className="w-full bg-background h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FOLLOWER">Follower</SelectItem>
                      <SelectItem value="STAKEHOLDER">Stakeholder</SelectItem>
                      <SelectItem value="EXEC">Executive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                type="submit"
                size="sm"
                className="w-full font-semibold h-8 text-xs"
                disabled={!selectedUserId}
              >
                <Users className="h-3.5 w-3.5 mr-2" />
                Add Watcher
              </Button>
            </form>
          ) : (
            <div className="p-3 bg-muted/40 rounded-lg border border-border/50 text-sm text-muted-foreground flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Only responders can manage watchers
            </div>
          )}

          {watchers.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-2">No watchers yet</p>
          ) : (
            <div className="space-y-2">
              {watchers.map(watcher => (
                <div
                  key={watcher.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card/50 hover:bg-accent/5 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      userId={watcher.user.id}
                      name={watcher.user.name}
                      gender={watcher.user.gender}
                      avatarUrl={watcher.user.avatarUrl}
                      size="sm"
                      className="h-9 w-9 border-2 border-white shadow-sm"
                      fallbackClassName="bg-primary/10 text-primary"
                    />
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {watcher.user.name}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {watcher.role.toLowerCase()}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <form action={onRemoveWatcher}>
                      <input type="hidden" name="watcherMemberId" value={watcher.id} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
