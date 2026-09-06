'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import {
  MoreHorizontal,
  Plus,
  ArrowRight,
  ShieldCheck,
  LayoutList,
  Clock,
  Trash2,
  Loader2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import PolicyDeleteButton from '@/components/PolicyDeleteButton';

type PolicyListItem = {
  id: string;
  name: string;
  description: string | null;
  stepCount: number;
  serviceCount: number;
  services: { id: string; name: string }[];
};

type PolicyListTableProps = {
  policies: PolicyListItem[];
  canManagePolicies: boolean;
};

export default function PolicyListTable({ policies, canManagePolicies }: PolicyListTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  const titleText = 'text-sm';
  const metaText = 'text-xs';
  const rowPad = 'p-3.5 md:p-4';

  if (policies.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-white p-10 text-center">
        <div className="text-4xl opacity-30 mb-3">
          <LayoutList className="mx-auto h-12 w-12" />
        </div>
        <p className="text-base font-bold text-slate-700 mb-1">No escalation policies yet</p>
        <p className="text-sm text-slate-500 m-0">
          {canManagePolicies
            ? 'Click "Create Policy" above to define who gets notified when incidents occur.'
            : 'No escalation policies have been created yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {policies.map(policy => (
        <div
          key={policy.id}
          className={cn(
            'group relative rounded-2xl border bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-all',
            'hover:shadow-md hover:-translate-y-[1px]',
            'focus-within:ring-2 focus-within:ring-primary/20',
            'border-slate-200',
            navigatingId === policy.id && 'opacity-70 pointer-events-none'
          )}
          onClick={e => {
            const target = e.target as HTMLElement;
            if (target.closest('[data-no-row-nav="true"]')) return;
            setNavigatingId(policy.id);
            startTransition(() => {
              router.push(`/policies/${policy.id}`);
            });
          }}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setNavigatingId(policy.id);
              startTransition(() => {
                router.push(`/policies/${policy.id}`);
              });
            }
          }}
        >
          {/* Loading overlay */}
          {navigatingId === policy.id && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px] rounded-2xl">
              <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-primary">Opening...</span>
              </div>
            </div>
          )}
          <div className={cn('flex gap-3 items-start', rowPad)}>
            {/* Main Content */}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link
                  href={`/policies/${policy.id}`}
                  data-no-row-nav="true"
                  onClick={e => e.stopPropagation()}
                  className={cn(
                    'block font-extrabold text-slate-900 leading-tight truncate',
                    titleText,
                    'group-hover:text-primary transition-colors'
                  )}
                >
                  {policy.name}
                </Link>
              </div>

              {policy.description && (
                <p className="text-sm text-slate-600 line-clamp-1">{policy.description}</p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className={cn('flex flex-wrap items-center gap-3 text-slate-500', metaText)}>
                  {/* Steps Badge */}
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium">
                    <Clock className="h-3 w-3" />
                    {policy.stepCount} step{policy.stepCount !== 1 ? 's' : ''}
                  </div>

                  <span className="opacity-30">|</span>

                  {/* Services Badge */}
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                    <span>
                      {policy.serviceCount} service{policy.serviceCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="self-start sm:self-center" data-no-row-nav="true">
              {canManagePolicies && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200"
                      onClick={e => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4 text-slate-600" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem asChild>
                      <Link
                        href={`/policies/${policy.id}`}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <LayoutList className="h-4 w-4 text-slate-500" />
                        View Details
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Note: Delete logic might need to be passed down or handled separately since PolicyDeleteButton has its own UI/Dialog */}
                    {/* For now, we link to details to delete, or we need to refactor PolicyDeleteButton to accept a trigger */}
                    {/* Ideally, we should allow delete from here too, but PolicyDeleteButton is its own complex component. 
                                 Let's keep it simple for now and only view details. */}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
