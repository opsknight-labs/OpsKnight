'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Clock, Trash2, MoreVertical, AlertTriangle } from 'lucide-react';
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

interface DashboardCardProps {
  id: string;
  name: string;
  description?: string | null;
  widgetCount: number;
  isDefault: boolean;
  updatedAt: string;
}

export default function DashboardCard({
  id,
  name,
  description,
  widgetCount,
  isDefault,
  updatedAt,
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
      alert('Failed to delete dashboard. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Card
        className={`h-full hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer group relative ${isDeleting ? 'opacity-50' : ''}`}
      >
        <Link href={`/reports/executive/${id}`} className="absolute inset-0 z-0" />

        {/* Actions Dropdown */}
        <div className="absolute top-3 right-3 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
                onClick={e => e.preventDefault()}
              >
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer"
                onClick={e => {
                  e.preventDefault();
                  setShowDeleteModal(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CardHeader>
          <div className="flex items-start justify-between">
            <LayoutDashboard className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            {isDefault && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                Default
              </span>
            )}
          </div>
          <CardTitle className="text-base mt-2 group-hover:text-primary transition-colors">
            {name}
          </CardTitle>
          {description && (
            <CardDescription className="text-xs line-clamp-2">{description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{widgetCount} widgets</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {updatedAt}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isDeleting && setShowDeleteModal(false)}
          />

          {/* Modal */}
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6 mx-4">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-1">Delete Dashboard</h3>
                <p className="text-sm text-muted-foreground mb-1">
                  Are you sure you want to delete <strong>&quot;{name}&quot;</strong>?
                </p>
                <p className="text-xs text-muted-foreground">
                  This action cannot be undone. All widgets and configurations will be permanently
                  removed.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? 'Deleting...' : 'Delete Dashboard'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
