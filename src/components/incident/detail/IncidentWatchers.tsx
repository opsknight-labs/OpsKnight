'use client';

import { useState, useTransition } from 'react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Trash2,
  Check,
  ChevronsUpDown,
  Plus,
  UserPlus,
  Bell,
  ChevronDown,
  ShieldAlert,
  Megaphone,
} from 'lucide-react';
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
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  canManage: boolean;
  currentUserId?: string | null;
  onAddWatcher: (formData: FormData) => void;
  onRemoveWatcher: (formData: FormData) => void;
  className?: string;
};

function getRoleBadge(role: string) {
  const norm = (role || 'FOLLOWER').toUpperCase();
  switch (norm) {
    case 'EXEC':
      return {
        label: 'Executive',
        subtitle: 'P1/P2 & Resolutions',
        cadence: 'Major outages (P1/P2) & Resolutions only',
        icon: ShieldAlert,
        className:
          'bg-amber-50 text-amber-800 border-amber-200/80 hover:bg-amber-100/70 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80',
      };
    case 'STAKEHOLDER':
      return {
        label: 'Stakeholder',
        subtitle: 'Milestones (Trigger, Ack, Resolve)',
        cadence: 'Status milestones (Triggered, Ack, Resolved)',
        icon: Megaphone,
        className:
          'bg-purple-50 text-purple-700 border-purple-200/80 hover:bg-purple-100/70 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/80',
      };
    default:
      return {
        label: 'Follower',
        subtitle: 'All operational updates',
        cadence: 'All lifecycle events & notes',
        icon: Bell,
        className:
          'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      };
  }
}

export default function IncidentWatchers({
  watchers,
  users,
  canManage,
  currentUserId,
  onAddWatcher,
  onRemoveWatcher,
  className,
}: IncidentWatchersProps) {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('STAKEHOLDER');
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedUser = users.find(u => u.id === selectedUserId);
  const availableUsers = users.filter(u => !watchers.some(w => w.user.id === u.id));

  // Current user watching status
  const currentWatcherRecord = currentUserId
    ? watchers.find(w => w.user.id === currentUserId)
    : null;
  const isCurrentWatcher = Boolean(currentWatcherRecord);

  const handleSelfWatch = () => {
    if (!currentUserId) return;
    const formData = new FormData();
    formData.append('watcherId', currentUserId);
    formData.append('watcherRole', 'FOLLOWER');

    startTransition(async () => {
      await onAddWatcher(formData);
    });
  };

  const handleSelfUnwatch = () => {
    if (!currentWatcherRecord) return;
    const formData = new FormData();
    formData.append('watcherMemberId', currentWatcherRecord.id);

    startTransition(async () => {
      await onRemoveWatcher(formData);
    });
  };

  const handleUpdateRole = (userId: string, newRole: string) => {
    const formData = new FormData();
    formData.append('watcherId', userId);
    formData.append('watcherRole', newRole);

    startTransition(async () => {
      await onAddWatcher(formData);
    });
  };

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedUserId) return;

    const formData = new FormData();
    formData.append('watcherId', selectedUserId);
    formData.append('watcherRole', selectedRole);

    startTransition(async () => {
      await onAddWatcher(formData);
      setSelectedUserId('');
      setOpen(false);
    });
  };

  // Role summary calculation for micro-footer
  const execCount = watchers.filter(w => (w.role || '').toUpperCase() === 'EXEC').length;
  const stakeholderCount = watchers.filter(
    w => (w.role || '').toUpperCase() === 'STAKEHOLDER'
  ).length;
  const followerCount = watchers.filter(
    w => !['EXEC', 'STAKEHOLDER'].includes((w.role || '').toUpperCase())
  ).length;

  const summaryParts: string[] = [];
  if (stakeholderCount > 0) {
    summaryParts.push(`${stakeholderCount} Stakeholder${stakeholderCount > 1 ? 's' : ''}`);
  }
  if (execCount > 0) {
    summaryParts.push(`${execCount} Exec${execCount > 1 ? 's' : ''}`);
  }
  if (followerCount > 0) {
    summaryParts.push(`${followerCount} Follower${followerCount > 1 ? 's' : ''}`);
  }
  const countsSummary = summaryParts.join(' · ') || `${watchers.length} Subscribed`;

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden dark:bg-slate-900 dark:border-slate-800 transition-all',
        className
      )}
    >
      {/* Header: Clean, generous, NO clipping. Title has full room. */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            <Bell className="h-4 w-4 shrink-0" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 whitespace-nowrap">
              Subscribers
            </h3>
            <Badge
              variant="secondary"
              className="text-[10px] h-4.5 px-1.5 font-semibold text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-400 shrink-0"
            >
              {watchers.length}
            </Badge>
          </div>
        </div>

        {/* Header Action: Only '+ Add' button. Clean & uncrowded. */}
        {canManage && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Add teammate as subscriber"
                className="h-7 px-2.5 text-xs font-semibold gap-1 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-2xs shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="p-4 w-80 shadow-xl border-slate-200 dark:border-slate-800 rounded-xl"
              align="end"
            >
              <form onSubmit={handleAddSubmit} className="space-y-3.5">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5 text-primary" />
                    Subscribe Teammate
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Select a teammate and their notification cadence.
                  </p>
                </div>

                {/* Searchable User Combobox */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Teammate
                  </label>
                  <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={userSearchOpen}
                        className="w-full justify-between h-9 text-xs bg-background px-2.5 font-normal border-slate-200 dark:border-slate-700"
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
                            <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                              {selectedUser.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 truncate">Select teammate...</span>
                        )}
                        <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 border shadow-md rounded-lg w-72" align="start">
                      <Command className="rounded-lg">
                        <CommandInput
                          placeholder="Search teammates..."
                          className="h-8 text-xs border-none focus:ring-0"
                        />
                        <CommandList className="max-h-48">
                          <CommandEmpty className="py-4 text-center text-xs text-slate-400">
                            No available teammates found.
                          </CommandEmpty>
                          <CommandGroup className="p-1">
                            {availableUsers.map(user => (
                              <CommandItem
                                key={user.id}
                                value={`${user.name}|${user.email}`}
                                onSelect={() => {
                                  setSelectedUserId(user.id);
                                  setUserSearchOpen(false);
                                }}
                                className="flex items-center gap-2 cursor-pointer text-xs rounded-md py-1.5"
                              >
                                <UserAvatar
                                  userId={user.id}
                                  name={user.name}
                                  gender={user.gender}
                                  avatarUrl={user.avatarUrl}
                                  size="xs"
                                  className="shrink-0"
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-semibold truncate text-xs">
                                    {user.name}
                                  </span>
                                  <span className="text-[10px] text-slate-400 truncate">
                                    {user.email}
                                  </span>
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
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Role Selector with Notification Cadence Descriptions */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Subscriber Cadence
                  </label>
                  <Select value={selectedRole} onValueChange={setSelectedRole}>
                    <SelectTrigger className="w-full bg-background h-9 text-xs border-slate-200 dark:border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STAKEHOLDER" className="text-xs">
                        <div className="font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                          <Megaphone className="h-3 w-3" />
                          Stakeholder
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Milestones: Triggered, Ack&apos;d, Resolved
                        </div>
                      </SelectItem>
                      <SelectItem value="EXEC" className="text-xs">
                        <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                          <ShieldAlert className="h-3 w-3" />
                          Executive
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Major Outages (P1/P2) &amp; Resolutions only
                        </div>
                      </SelectItem>
                      <SelectItem value="FOLLOWER" className="text-xs">
                        <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Bell className="h-3 w-3" />
                          Follower
                        </div>
                        <div className="text-[10px] text-slate-500">
                          All lifecycle transitions &amp; updates
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Submit button */}
                <Button
                  type="submit"
                  size="sm"
                  disabled={!selectedUserId || isPending}
                  className="w-full font-semibold h-8 text-xs gap-1.5"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>{isPending ? 'Subscribing...' : 'Subscribe Teammate'}</span>
                </Button>
              </form>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Dedicated Personal Subscription Row: Clear, uncrowded, high-contrast */}
      {currentUserId && (
        <div className="p-3 pb-0">
          {isCurrentWatcher ? (
            <div className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center shrink-0">
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-950 dark:text-emerald-200 leading-snug truncate">
                    You are subscribed
                  </p>
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 leading-snug truncate">
                    Receiving updates as{' '}
                    {getRoleBadge(currentWatcherRecord?.role || 'FOLLOWER').label}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelfUnwatch}
                disabled={isPending}
                className="h-6 px-2 text-[11px] font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 shrink-0"
              >
                Unsubscribe
              </Button>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-slate-200/70 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <Bell className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-snug truncate">
                    Get incident updates
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug truncate">
                    Subscribe yourself to notifications
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleSelfWatch}
                disabled={isPending}
                className="h-7 px-2.5 text-xs font-semibold gap-1.5 shrink-0 shadow-2xs"
              >
                <Bell className="h-3 w-3" />
                Subscribe
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Subscribed Teammates List or Empty State */}
      <div className="p-3">
        {watchers.length === 0 ? (
          <div className="text-center py-4 px-2 space-y-1.5">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              No teammates subscribed yet
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 max-w-[220px] mx-auto leading-relaxed">
              Add leads, executives, or team members who need visibility into this incident.
            </p>
            {canManage && (
              <div className="pt-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(true)}
                  className="h-7 px-3 text-xs font-semibold gap-1.5 bg-white dark:bg-slate-800"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Add Teammate
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 pb-0.5">
              Subscribed Teammates ({watchers.length})
            </div>
            <div className="space-y-1">
              {watchers.map(watcher => {
                const roleInfo = getRoleBadge(watcher.role);
                const RoleIcon = roleInfo.icon;
                return (
                  <div
                    key={watcher.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <UserAvatar
                        userId={watcher.user.id}
                        name={watcher.user.name}
                        gender={watcher.user.gender}
                        avatarUrl={watcher.user.avatarUrl}
                        size="sm"
                        className="border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate leading-snug">
                            {watcher.user.name}
                          </span>
                          {watcher.user.id === currentUserId && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold shrink-0">
                              You
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate leading-snug">
                          {roleInfo.subtitle}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Inline Interactive Role Dropdown */}
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild disabled={isPending}>
                            <button
                              type="button"
                              title={`Click to change role. Cadence: ${roleInfo.cadence}`}
                              className={cn(
                                'text-[10px] px-1.5 py-0 h-5 font-semibold rounded border inline-flex items-center gap-1 transition-all hover:ring-2 hover:ring-offset-0 cursor-pointer',
                                roleInfo.className
                              )}
                            >
                              <RoleIcon className="h-2.5 w-2.5 shrink-0" />
                              <span>{roleInfo.label}</span>
                              <ChevronDown className="h-2.5 w-2.5 opacity-60 ml-0.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 p-1">
                            <DropdownMenuItem
                              onClick={() => handleUpdateRole(watcher.user.id, 'FOLLOWER')}
                              className="flex flex-col items-start gap-0.5 cursor-pointer text-xs"
                            >
                              <div className="flex items-center justify-between w-full font-semibold">
                                <span className="flex items-center gap-1.5">
                                  <Bell className="h-3 w-3 text-slate-500" />
                                  Follower
                                </span>
                                {watcher.role === 'FOLLOWER' && (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400">
                                All updates &amp; lifecycle transitions
                              </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdateRole(watcher.user.id, 'STAKEHOLDER')}
                              className="flex flex-col items-start gap-0.5 cursor-pointer text-xs"
                            >
                              <div className="flex items-center justify-between w-full font-semibold text-purple-700 dark:text-purple-300">
                                <span className="flex items-center gap-1.5">
                                  <Megaphone className="h-3 w-3 text-purple-600" />
                                  Stakeholder
                                </span>
                                {watcher.role === 'STAKEHOLDER' && (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400">
                                Milestones (Triggered, Ack, Resolve)
                              </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdateRole(watcher.user.id, 'EXEC')}
                              className="flex flex-col items-start gap-0.5 cursor-pointer text-xs"
                            >
                              <div className="flex items-center justify-between w-full font-semibold text-amber-700 dark:text-amber-300">
                                <span className="flex items-center gap-1.5">
                                  <ShieldAlert className="h-3 w-3 text-amber-600" />
                                  Executive
                                </span>
                                {watcher.role === 'EXEC' && (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400">
                                Major outages (P1/P2) &amp; Resolutions only
                              </span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Badge
                          variant="outline"
                          title={`Cadence: ${roleInfo.cadence}`}
                          className={cn(
                            'text-[10px] px-1.5 py-0 h-5 font-semibold rounded inline-flex items-center gap-1',
                            roleInfo.className
                          )}
                        >
                          <RoleIcon className="h-2.5 w-2.5 shrink-0" />
                          <span>{roleInfo.label}</span>
                        </Badge>
                      )}

                      {/* Delete Watcher Button */}
                      {canManage && (
                        <form action={onRemoveWatcher}>
                          <input type="hidden" name="watcherMemberId" value={watcher.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${watcher.user.name}`}
                            className="h-6 w-6 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sleek Cadence Micro-bar */}
      <div className="border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/20 px-3.5 py-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span className="text-[10px] font-medium tracking-wide truncate mr-2">{countsSummary}</span>
        <div className="flex items-center gap-2.5 text-[10px] shrink-0">
          <span
            className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 cursor-help"
            title="Executive: Notified for P1/P2 major outages and resolutions"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Exec</span>
          </span>
          <span
            className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 cursor-help"
            title="Stakeholder: Notified for status milestones (Triggered, Ack, Resolved)"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            <span>Stakeholder</span>
          </span>
          <span
            className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 cursor-help"
            title="Follower: Notified for all lifecycle updates and notes"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span>Follower</span>
          </span>
        </div>
      </div>
    </div>
  );
}
