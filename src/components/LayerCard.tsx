'use client';

import { useTransition, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import LayerEditSheet from './LayerEditSheet';
import ResponderCombobox, { type ResponderOption } from './ResponderCombobox';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import UserAvatar from '@/components/UserAvatar';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import {
  Trash2,
  Edit3,
  Users,
  Clock,
  ArrowUp,
  ArrowDown,
  Layers,
  Info,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';

type LayerRestrictions = {
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
};

type LayerCardProps = {
  layer: {
    id: string;
    name: string;
    start: Date;
    end: Date | null;
    rotationLengthHours: number;
    shiftLengthHours?: number | null;
    restrictions?: LayerRestrictions | null;
    users: Array<{
      userId: string;
      position: number;
      user: { name: string; avatarUrl?: string | null; gender?: string | null };
    }>;
  };
  scheduleId: string;
  timeZone: string;
  users: ResponderOption[];
  canManageSchedules: boolean;
  updateLayer: (layerId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  deleteLayer: (scheduleId: string, layerId: string) => Promise<{ error?: string } | undefined>;
  addLayerUser: (layerId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  moveLayerUser: (
    layerId: string,
    userId: string,
    direction: 'up' | 'down'
  ) => Promise<{ error?: string } | undefined>;
  removeLayerUser: (layerId: string, userId: string) => Promise<{ error?: string } | undefined>;
  colorIndex?: number;
};

const LAYER_COLORS = [
  { bg: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  {
    bg: 'bg-violet-500',
    light: 'bg-violet-50',
    text: 'text-violet-700',
    border: 'border-violet-200',
  },
  {
    bg: 'bg-emerald-500',
    light: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
  },
  { bg: 'bg-amber-500', light: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  { bg: 'bg-rose-500', light: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
];

function formatShortTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date);
}

function getDayName(day: number): string {
  switch (day) {
    case 0:
      return 'Sun';
    case 1:
      return 'Mon';
    case 2:
      return 'Tue';
    case 3:
      return 'Wed';
    case 4:
      return 'Thu';
    case 5:
      return 'Fri';
    case 6:
      return 'Sat';
    default:
      return '';
  }
}

function formatRestrictions(restrictions: LayerRestrictions | null | undefined): string[] {
  if (!restrictions) return [];

  const badges: string[] = [];
  if (restrictions.daysOfWeek && restrictions.daysOfWeek.length > 0) {
    const days = [...restrictions.daysOfWeek].sort((a, b) => a - b);
    const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d));
    const isWeekends = days.length === 2 && days.includes(0) && days.includes(6);

    if (isWeekdays) badges.push('Mon-Fri');
    else if (isWeekends) badges.push('Sat-Sun');
    else if (days.length <= 3) badges.push(days.map(d => getDayName(d)).filter(Boolean).join(', '));
    else badges.push(`${days.length} days`);
  }

  if (restrictions.startHour != null && restrictions.endHour != null) {
    const start = restrictions.startHour.toString().padStart(2, '0');
    const end = restrictions.endHour.toString().padStart(2, '0');
    badges.push(`${start}:00-${end}:00`);
  } else if (restrictions.startHour != null) {
    badges.push(`from ${restrictions.startHour.toString().padStart(2, '0')}:00`);
  } else if (restrictions.endHour != null) {
    badges.push(`until ${restrictions.endHour.toString().padStart(2, '0')}:00`);
  }

  return badges;
}

function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label="Layer help"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Info className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="max-w-[250px] text-xs z-50 bg-slate-900 text-white border-slate-800"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function LayerCard({
  layer,
  scheduleId,
  timeZone,
  users,
  canManageSchedules,
  updateLayer,
  deleteLayer,
  addLayerUser,
  moveLayerUser,
  removeLayerUser,
  colorIndex = 0,
}: LayerCardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const color = LAYER_COLORS[colorIndex % LAYER_COLORS.length];

  const handleDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    startTransition(async () => {
      const result = await deleteLayer(scheduleId, layer.id);
      if (result?.error) {
        showToast(result.error, 'error');
      } else {
        showToast('Layer deleted', 'success');
        router.refresh();
      }
    });
  }, [scheduleId, layer.id, deleteLayer, showToast, router]);

  const handleAddUser = useCallback(
    (userId: string) => {
      startTransition(async () => {
        const formData = new FormData();
        formData.set('userId', userId);
        const result = await addLayerUser(layer.id, formData);
        if (result?.error) {
          notify.error('Responder could not be added', { description: result.error });
        } else {
          showToast('Responder added', 'success');
          router.refresh();
        }
      });
    },
    [layer.id, addLayerUser, showToast, router]
  );

  const handleMoveUser = useCallback(
    async (userId: string, direction: 'up' | 'down') => {
      startTransition(async () => {
        const result = await moveLayerUser(layer.id, userId, direction);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          router.refresh();
        }
      });
    },
    [layer.id, moveLayerUser, showToast, router]
  );

  const handleRemoveUser = useCallback(
    async (userId: string) => {
      startTransition(async () => {
        const result = await removeLayerUser(layer.id, userId);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Responder removed', 'success');
          router.refresh();
        }
      });
    },
    [layer.id, removeLayerUser, showToast, router]
  );

  // Parent pages should already supply schedule-wide assignable users. Keep a
  // local guard as defense in depth so this component never offers a current
  // layer member even if reused elsewhere.
  const availableUsers = users.filter(
    user => !layer.users.some(layerUser => layerUser.userId === user.id)
  );

  return (
    <>
      <Card
        className={cn('overflow-hidden border-l-4 border-slate-200/80 shadow-sm', color.border)}
      >
        <div className="flex items-start justify-between gap-3 p-3 bg-slate-50/70">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center', color.light)}>
              <Layers className={cn('h-4 w-4', color.text)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-800 truncate">{layer.name}</h3>
                <HelpTip>
                  <p>
                    <strong>Layer:</strong> A rotation pattern that cycles through responders.
                    Multiple layers can run simultaneously.
                  </p>
                </HelpTip>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                <Badge variant="secondary" size="xs">
                  {layer.rotationLengthHours}h rotation
                </Badge>
                {layer.shiftLengthHours && layer.shiftLengthHours !== layer.rotationLengthHours && (
                  <Badge
                    variant="outline"
                    size="xs"
                    className="border-orange-200 bg-orange-50 text-orange-700"
                  >
                    {layer.shiftLengthHours}h shift
                  </Badge>
                )}
                {layer.restrictions &&
                  (layer.restrictions.daysOfWeek?.length ||
                    layer.restrictions.startHour != null) &&
                  formatRestrictions(layer.restrictions).map((badge, index) => (
                    <Badge
                      key={index}
                      variant="outline"
                      size="xs"
                      className="border-purple-200 bg-purple-50 text-purple-700"
                    >
                      {badge}
                    </Badge>
                  ))}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatShortTime(new Date(layer.start), timeZone)}
                  {layer.end
                    ? ` - ${formatShortTime(new Date(layer.end), timeZone)}`
                    : ' - Open ended'}
                </span>
              </div>
            </div>
          </div>

          {canManageSchedules && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditOpen(!isEditOpen)}
                className={cn('h-7 w-7', isEditOpen && 'bg-slate-200')}
                aria-label={`Edit ${layer.name}`}
              >
                <Edit3 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDeleteConfirm(true)}
                className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                aria-label={`Delete ${layer.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <CardContent className="p-0">
          <LayerEditSheet
            layer={{
              id: layer.id,
              name: layer.name,
              start: new Date(layer.start),
              end: layer.end ? new Date(layer.end) : null,
              rotationLengthHours: layer.rotationLengthHours,
              shiftLengthHours: layer.shiftLengthHours,
              restrictions: layer.restrictions,
            }}
            timeZone={timeZone}
            updateLayer={updateLayer}
            open={isEditOpen}
            onOpenChange={setIsEditOpen}
          />

          <div className="border-t border-slate-100">
            <div className="flex items-center justify-between gap-3 p-2.5 px-3 bg-slate-50/50">
              <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">Responders</span>
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px] bg-slate-100">
                  {layer.users.length}
                </Badge>
              </div>
              {canManageSchedules && (
                <ResponderCombobox
                  users={availableUsers}
                  onSelect={handleAddUser}
                  disabled={isPending}
                />
              )}
            </div>

            {layer.users.length === 0 ? (
              <div className="px-4 py-5 text-center">
                <Users className="mx-auto mb-1.5 h-5 w-5 text-slate-300" />
                <p className="text-xs font-medium text-slate-500">No responders in this rotation</p>
                {canManageSchedules && (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Add an active responder to start coverage.
                  </p>
                )}
              </div>
            ) : (
              <div className="px-3 pb-3 pt-2 space-y-2">
                {layer.users.map((layerUser, index) => (
                  <div
                    key={layerUser.userId}
                    className={cn(
                      'flex items-center justify-between py-2 px-2 rounded-md hover:bg-slate-50 group',
                      isPending && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          'w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center shrink-0',
                          index === 0
                            ? `${color.light} ${color.text}`
                            : 'bg-slate-100 text-slate-500'
                        )}
                      >
                        {index + 1}
                      </span>
                      <UserAvatar
                        userId={layerUser.userId}
                        name={layerUser.user.name}
                        gender={layerUser.user.gender}
                        avatarUrl={layerUser.user.avatarUrl}
                        size="xs"
                        className="h-6 w-6 shrink-0"
                      />
                      <span className="text-sm font-medium text-slate-700 truncate">
                        {layerUser.user.name}
                      </span>
                      {index === 0 && (
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[8px] bg-emerald-50 text-emerald-600 border-emerald-100 shrink-0"
                        >
                          NEXT
                        </Badge>
                      )}
                    </div>
                    {canManageSchedules && (
                      <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleMoveUser(layerUser.userId, 'up')}
                          disabled={index === 0 || isPending}
                          className="h-7 w-7"
                          aria-label={`Move ${layerUser.user.name} up`}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleMoveUser(layerUser.userId, 'down')}
                          disabled={index === layer.users.length - 1 || isPending}
                          className="h-7 w-7"
                          aria-label={`Move ${layerUser.user.name} down`}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveUser(layerUser.userId)}
                          disabled={isPending}
                          className="h-7 w-7 text-slate-400 hover:text-red-500"
                          aria-label={`Remove ${layerUser.user.name} from ${layer.name}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-4 w-4" />
              Delete Layer
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              Delete <strong>{layer.name}</strong>? This removes all responders from this layer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="h-8 text-xs bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
