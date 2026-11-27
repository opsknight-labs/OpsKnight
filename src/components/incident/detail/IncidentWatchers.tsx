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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Button } from '@/components/ui/shadcn/button';
import {
  Trash2,
  Check,
  ChevronsUpDown,
  Plus,
  UserPlus,
  Bell,
  BellOff,
  ChevronDown,
  ShieldAlert,
  Megaphone,
} from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import IncidentUserPicker from './IncidentUserPicker';
import { cn } from '@/lib/utils';
import { FIELD_SELECT_CLASS } from '@/components/incident/field-styles';

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

// Roles are told apart by icon and label, not colour: amber/violet mean status and on-call on this page.
function getRoleBadge(role: string) {
  const norm = (role || 'FOLLOWER').toUpperCase();
  switch (norm) {
    case 'EXEC':
      return {
        label: 'Executive',
        subtitle: 'P1/P2 & Resolutions',
        cadence: 'Major outages (P1/P2) & Resolutions only',
        icon: ShieldAlert,
      };
    case 'STAKEHOLDER':
      return {
        label: 'Stakeholder',
        subtitle: 'Milestones (Trigger, Ack, Resolve)',
        cadence: 'Status milestones (Triggered, Ack, Resolved)',
        icon: Megaphone,
      };
    default:
      return {
        label: 'Follower',
        subtitle: 'All operational updates',
        cadence: 'All lifecycle events & notes',
        icon: Bell,
      };
  }
}

// Compact (h-7) version of the Details card select, for the per-row role dropdown.
const ROLE_SELECT_CLASS = cn(FIELD_SELECT_CLASS, 'h-7 gap-1 px-2 text-xs');

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

  const roleMenuItems = [
    { value: 'FOLLOWER', label: 'Follower', icon: Bell, hint: 'All updates & lifecycle transitions' },
    {
      value: 'STAKEHOLDER',
      label: 'Stakeholder',
      icon: Megaphone,
      hint: 'Milestones (Triggered, Ack, Resolve)',
    },
    {
      value: 'EXEC',
      label: 'Executive',
      icon: ShieldAlert,
      hint: 'Major outages (P1/P2) & Resolutions only',
    },
  ];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          Subscribers
          <span className="font-normal tabular-nums text-muted-foreground">{watchers.length}</span>
        </h2>

        {canManage && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Add teammate as subscriber"
                className="-my-1.5 h-7 shrink-0 gap-1 px-2 text-xs font-medium shadow-2xs pointer-coarse:my-0 pointer-coarse:h-11"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 rounded-xl p-4 shadow-xl" align="end">
              <form onSubmit={handleAddSubmit} className="space-y-3.5">
                <div>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                    Subscribe teammate
                  </h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Select a teammate and their notification cadence.
                  </p>
                </div>

                {/* Searchable User Combobox */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Teammate</label>
                  <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={userSearchOpen}
                        className="h-8 w-full justify-between bg-background px-2.5 text-xs font-normal"
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
                              aria-hidden
                            />
                            <span className="truncate font-medium text-foreground">
                              {selectedUser.name}
                            </span>
                          </div>
                        ) : (
                          <span className="truncate text-muted-foreground">Select teammate...</span>
                        )}
                        <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 rounded-lg border p-0 shadow-md" align="start">
                      <IncidentUserPicker
                        users={availableUsers}
                        selectedUserId={selectedUserId}
                        onSelect={user => {
                          setSelectedUserId(user.id);
                          setUserSearchOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Role Selector with Notification Cadence Descriptions */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Subscriber cadence</label>
                  <Select value={selectedRole} onValueChange={setSelectedRole}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STAKEHOLDER" className="text-xs">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Megaphone className="h-3 w-3" />
                          Stakeholder
                        </div>
                        <div className="text-2xs text-muted-foreground">
                          Milestones: Triggered, Ack&apos;d, Resolved
                        </div>
                      </SelectItem>
                      <SelectItem value="EXEC" className="text-xs">
                        <div className="flex items-center gap-1.5 font-medium">
                          <ShieldAlert className="h-3 w-3" />
                          Executive
                        </div>
                        <div className="text-2xs text-muted-foreground">
                          Major Outages (P1/P2) &amp; Resolutions only
                        </div>
                      </SelectItem>
                      <SelectItem value="FOLLOWER" className="text-xs">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Bell className="h-3 w-3" />
                          Follower
                        </div>
                        <div className="text-2xs text-muted-foreground">
                          All lifecycle transitions &amp; updates
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="submit"
                  size="sm"
                  disabled={!selectedUserId || isPending}
                  className="h-8 w-full gap-1.5 text-xs font-medium"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>{isPending ? 'Subscribing...' : 'Subscribe teammate'}</span>
                </Button>
              </form>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="flex flex-col divide-y divide-border/50">
        {/* Your own subscription: one compact row */}
        {currentUserId && (
          <div className="flex min-h-10 items-center justify-between gap-2 px-3 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {isCurrentWatcher ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <BellOff className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">
                {isCurrentWatcher ? (
                  <>
                    You&apos;re subscribed as{' '}
                    <span className="font-medium text-foreground">
                      {getRoleBadge(currentWatcherRecord?.role || 'FOLLOWER').label}
                    </span>
                  </>
                ) : (
                  'You’re not subscribed'
                )}
              </span>
            </span>
            {isCurrentWatcher ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelfUnwatch}
                disabled={isPending}
                className="h-7 shrink-0 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Unsubscribe
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelfWatch}
                disabled={isPending}
                className="h-7 shrink-0 gap-1 px-2 text-xs font-medium shadow-2xs"
              >
                <Bell className="h-3.5 w-3.5" />
                Subscribe
              </Button>
            )}
          </div>
        )}

        {watchers.length === 0 ? (
          <div className="space-y-1 px-3 py-4 text-center">
            <p className="text-xs font-medium text-foreground">No teammates subscribed yet</p>
            <p className="mx-auto max-w-[220px] text-xs text-muted-foreground">
              Add leads, executives, or team members who need visibility into this incident.
            </p>
            {canManage && (
              <div className="pt-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(true)}
                  className="h-7 gap-1 px-2 text-xs font-medium"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Add teammate
                </Button>
              </div>
            )}
          </div>
        ) : (
          watchers.map(watcher => {
            const roleInfo = getRoleBadge(watcher.role);
            const RoleIcon = roleInfo.icon;
            return (
              <div
                key={watcher.id}
                className="group flex min-h-10 items-center justify-between gap-2 px-3 py-1.5 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <UserAvatar
                    userId={watcher.user.id}
                    name={watcher.user.name}
                    gender={watcher.user.gender}
                    avatarUrl={watcher.user.avatarUrl}
                    size="xs"
                    className="shrink-0"
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {watcher.user.name}
                      </span>
                      {watcher.user.id === currentUserId && (
                        <span className="shrink-0 rounded bg-muted px-1 text-2xs font-medium text-muted-foreground">
                          You
                        </span>
                      )}
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {roleInfo.subtitle}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={isPending}>
                        <button
                          type="button"
                          title={`Click to change role. Cadence: ${roleInfo.cadence}`}
                          className={ROLE_SELECT_CLASS}
                        >
                          <RoleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span>{roleInfo.label}</span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 p-1">
                        {roleMenuItems.map(item => {
                          const ItemIcon = item.icon;
                          return (
                            <DropdownMenuItem
                              key={item.value}
                              onClick={() => handleUpdateRole(watcher.user.id, item.value)}
                              className="flex cursor-pointer flex-col items-start gap-0.5 text-xs"
                            >
                              <div className="flex w-full items-center justify-between font-medium">
                                <span className="flex items-center gap-1.5">
                                  <ItemIcon className="h-3 w-3 text-muted-foreground" />
                                  {item.label}
                                </span>
                                {watcher.role === item.value && (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                )}
                              </div>
                              <span className="text-2xs text-muted-foreground">{item.hint}</span>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span
                      title={`Cadence: ${roleInfo.cadence}`}
                      className="inline-flex h-7 items-center gap-1 text-xs font-medium text-foreground"
                    >
                      <RoleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {roleInfo.label}
                    </span>
                  )}

                  {canManage && (
                    <form action={onRemoveWatcher}>
                      <input type="hidden" name="watcherMemberId" value={watcher.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${watcher.user.name}`}
                        className="h-7 w-7 rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-rose-50 hover:text-rose-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Cadence legend: one quiet line */}
      <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-1.5 text-2xs text-muted-foreground">
        <span className="truncate">{countsSummary}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className="inline-flex cursor-help items-center gap-0.5"
            title="Executive: Notified for P1/P2 major outages and resolutions"
          >
            <ShieldAlert className="h-3 w-3" />
            Exec
          </span>
          <span
            className="inline-flex cursor-help items-center gap-0.5"
            title="Stakeholder: Notified for status milestones (Triggered, Ack, Resolved)"
          >
            <Megaphone className="h-3 w-3" />
            Stakeholder
          </span>
          <span
            className="inline-flex cursor-help items-center gap-0.5"
            title="Follower: Notified for all lifecycle updates and notes"
          >
            <Bell className="h-3 w-3" />
            Follower
          </span>
        </span>
      </div>
    </div>
  );
}
