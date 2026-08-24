'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import ConfirmDialog from './ConfirmDialog';
import { formatDateTime } from '@/lib/timezone';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Avatar, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { ArrowRight, Trash2, User } from 'lucide-react';

type Override = {
  id: string;
  start: Date;
  end: Date;
  userId: string;
  replacesUserId: string | null;
  user: { name: string };
  replacesUser: { name: string } | null;
};

type OverrideListProps = {
  overrides: Override[];
  scheduleId: string;
  canManageSchedules: boolean;
  deleteOverride: (
    scheduleId: string,
    overrideId: string
  ) => Promise<{ error?: string } | undefined>;
  timeZone: string;
  title: string;
  emptyMessage: string;
};

export default function OverrideList({
  overrides,
  scheduleId,
  canManageSchedules,
  deleteOverride,
  timeZone,
  title,
  emptyMessage,
}: OverrideListProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [deleteOverrideId, setDeleteOverrideId] = useState<string | null>(null);

  const handleDelete = async (overrideId: string) => {
    setDeleteOverrideId(null);
    startTransition(async () => {
      const result = await deleteOverride(scheduleId, overrideId);
      if (result?.error) {
        showToast(result.error, 'error');
      } else {
        showToast('Override deleted successfully', 'success');
        router.refresh();
      }
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <>
      <div className="mt-6 pt-6 border-t-2">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-base font-semibold">{title}</h4>
          {overrides.length > 0 && (
            <Badge variant="secondary" size="xs">
              {overrides.length}
            </Badge>
          )}
        </div>

        {overrides.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-6 text-center">
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {overrides.map(override => (
              <Card key={override.id} className="transition-all duration-200 hover:shadow-md">
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8 bg-gradient-to-br from-red-500 to-red-700">
                        <AvatarFallback className="bg-gradient-to-br from-red-500 to-red-700 text-white text-xs font-semibold">
                          {getInitials(override.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-semibold text-sm">{override.user.name}</span>
                    </div>

                    <div className="flex items-center gap-2 text-xs ml-11">
                      <Badge variant="outline" size="xs">
                        {formatDateTime(override.start, timeZone, { format: 'short' })}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <Badge variant="outline" size="xs">
                        {formatDateTime(override.end, timeZone, { format: 'short' })}
                      </Badge>
                    </div>

                    {override.replacesUser && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-11">
                        <User className="h-3 w-3" />
                        <span className="italic">
                          {title.includes('Upcoming') ? 'Replaces' : 'Replaced'}{' '}
                          <strong>{override.replacesUser.name}</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  {canManageSchedules ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteOverrideId(override.id)}
                      disabled={isPending}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled
                      className="shrink-0"
                      title="Admin or Responder role required"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {deleteOverrideId && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Override"
          message="Are you sure you want to delete this override? This action cannot be undone."
          confirmText="Delete Override"
          cancelText="Cancel"
          variant="danger"
          onConfirm={() => handleDelete(deleteOverrideId)}
          onCancel={() => setDeleteOverrideId(null)}
        />
      )}
    </>
  );
}
