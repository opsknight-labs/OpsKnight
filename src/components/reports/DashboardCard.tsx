'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Clock, Trash2, MoreVertical } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Button } from '@/components/ui/shadcn/button';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { RelativeTime } from '@/components/patterns';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface DashboardCardProps {
  id: string;
  name: string;
  description?: string | null;
  widgetCount: number;
  isDefault: boolean;
  /** Last update; a Date/ISO string renders as relative time, any other string as-is. */
  updatedAt: Date | string;
  ownerName?: string | null;
  visibility?: string;
  canDelete?: boolean;
}

export default function DashboardCard({
  id,
  name,
  description,
  widgetCount,
  isDefault,
  updatedAt,
  ownerName,
  visibility,
  canDelete = true,
}: DashboardCardProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/dashboards/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete dashboard');
      }

      setShowDeleteModal(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to delete dashboard:', error);
      notify.error('Failed to delete dashboard. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const isDate = updatedAt instanceof Date || !Number.isNaN(Date.parse(String(updatedAt)));

  return (
    <>
      <Card
        className={cn(
          'group relative h-full transition-[border-color,box-shadow] duration-150 focus-within:border-ring hover:border-ink-300 hover:shadow-md',
          isDeleting && 'opacity-50'
        )}
      >
        {canDelete && (
          <div className="absolute right-3 top-3 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-icon-button=""
                  aria-label={`Actions for ${name}`}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onSelect={() => setShowDeleteModal(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <CardHeader>
          <div className="flex items-start justify-between gap-2 pr-8">
            <LayoutDashboard className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              {isDefault && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                  Default
                </span>
              )}
              {visibility && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-semibold text-muted-foreground">
                  {visibility === 'TEAM' ? 'Team' : visibility === 'PUBLIC' ? 'Public' : 'Private'}
                </span>
              )}
            </div>
          </div>
          <CardTitle className="mt-2 text-base">
            {/* The link covers the whole card; the actions menu sits above it. */}
            <Link
              href={`/reports/executive/${id}`}
              className="rounded-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none group-hover:underline"
            >
              {name}
            </Link>
          </CardTitle>
          {ownerName && <p className="text-xs text-muted-foreground">By {ownerName}</p>}
          {description && (
            <CardDescription className="line-clamp-2 text-xs">{description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              {widgetCount} {widgetCount === 1 ? 'widget' : 'widgets'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {isDate ? <RelativeTime date={updatedAt} /> : updatedAt}
            </span>
          </div>
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={showDeleteModal}
        onOpenChange={open => !isDeleting && setShowDeleteModal(open)}
        title="Delete dashboard"
        description={
          <>
            Delete <strong>&quot;{name}&quot;</strong>? Its widgets and layout are removed
            permanently.
          </>
        }
        confirmText="Delete dashboard"
        onConfirm={handleDelete}
      />
    </>
  );
}
