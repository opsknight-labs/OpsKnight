'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import type { ScheduleActionState } from '@/lib/schedule-action-errors';
import type { OverrideStatus } from '@/lib/schedules/detail-view-model';
import { formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import ConfirmDialog from './ConfirmDialog';
import { DirectUserAvatar } from './UserAvatar';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { ArrowRight, Plus, Repeat2, Trash2 } from 'lucide-react';

export type PresentedOverride = {
  id: string;
  start: Date;
  end: Date;
  userId: string;
  replacesUserId: string | null;
  user: { name: string; avatarUrl?: string | null; gender?: string | null };
  replacesUser: { name: string } | null;
};

type OverrideListProps = {
  overrides: PresentedOverride[];
  scheduleId: string;
  canDeleteOverride: boolean;
  deleteOverride: (
    scheduleId: string,
    overrideId: string
  ) => Promise<ScheduleActionState | undefined>;
  timeZone: string;
  status: OverrideStatus;
  emptyMessage: string;
};

function getStatusVariant(status: OverrideStatus): 'success' | 'warning' | 'secondary' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'UPCOMING') return 'warning';
  return 'secondary';
}

export default function OverrideList({
  overrides,
  scheduleId,
  canDeleteOverride,
  deleteOverride,
  timeZone,
  status,
  emptyMessage,
}: OverrideListProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [deleteOverrideId, setDeleteOverrideId] = useState<string | null>(null);

  const handleDelete = (overrideId: string) => {
    setDeleteOverrideId(null);
    startTransition(async () => {
      try {
        const result = await deleteOverride(scheduleId, overrideId);
        if (result?.error) return showToast(result, 'error');
        showToast('Override deleted successfully.', 'success');
        router.refresh();
      } catch (error) {
        showToast(error, 'error');
      }
    });
  };

  if (overrides.length === 0) {
    return (
      <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {overrides.map(override => {
          const isReplacement = Boolean(override.replacesUserId);
          return (
            <Card key={override.id} className="p-4">
              <div className="flex items-start gap-3">
                <DirectUserAvatar
                  avatarUrl={
                    override.user.avatarUrl ||
                    getDefaultAvatar(override.user.gender, override.userId)
                  }
                  name={override.user.name}
                  size="sm"
                  className="h-9 w-9"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{override.user.name}</p>
                    <Badge variant={isReplacement ? 'outline' : 'secondary'} size="xs">
                      {isReplacement ? (
                        <span className="inline-flex items-center gap-1">
                          <Repeat2 className="h-3 w-3" /> Replacement
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Plus className="h-3 w-3" /> Extra coverage
                        </span>
                      )}
                    </Badge>
                    <Badge variant={getStatusVariant(status)} size="xs">
                      {status.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(override.start, timeZone, { format: 'short' })}
                    <ArrowRight className="mx-1 inline h-3 w-3" />
                    {formatDateTime(override.end, timeZone, { format: 'short' })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isReplacement
                      ? `${status === 'COMPLETED' ? 'Replaced' : 'Replaces'} ${override.replacesUser?.name ?? 'a scheduled responder'}`
                      : 'Adds coverage without removing scheduled responders'}
                  </p>
                </div>
                {canDeleteOverride && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteOverrideId(override.id)}
                    disabled={isPending}
                    aria-label={`Delete override for ${override.user.name}`}
                    className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {deleteOverrideId && (
        <ConfirmDialog
          isOpen
          title="Delete override"
          message="Delete this override? Effective coverage will immediately return to the remaining schedule."
          confirmText="Delete override"
          cancelText="Keep override"
          variant="danger"
          onConfirm={() => handleDelete(deleteOverrideId)}
          onCancel={() => setDeleteOverrideId(null)}
        />
      )}
    </>
  );
}
