'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Download, GitCompare, History, MoreHorizontal, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { ActionForm, SubmitButton, type RunbookFormAction } from '../RunbookControls';

export function RunbookActionsMenu({
  runbookId,
  runbookName = 'this runbook',
  canRun = false,
  exportHref,
  draftExportHref,
  duplicateAction,
  duplicateDescription = 'Creates a new draft copy with identical metadata.',
}: {
  runbookId: string;
  runbookName?: string;
  canRun?: boolean;
  exportHref?: string | null;
  draftExportHref?: string | null;
  duplicateAction?: RunbookFormAction;
  duplicateDescription?: string;
}) {
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const hasExport = Boolean(exportHref || draftExportHref);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label="More runbook actions"
            className="h-9 w-9 p-0 rounded-xl border border-zinc-700/80 bg-zinc-800/80 hover:bg-zinc-700 text-slate-200 hover:text-white shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=open]:border-zinc-500 data-[state=open]:bg-zinc-700"
          >
            <MoreHorizontal className="h-4 w-4 text-slate-200" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md p-1.5 shadow-xl space-y-0.5"
        >
          {canRun && (
            <>
              <DropdownMenuItem
                asChild
                className="rounded-xl px-2.5 py-2 text-xs font-medium cursor-pointer transition-colors hover:bg-muted/70 focus:bg-primary/10 focus:text-primary gap-2.5"
              >
                <Link href={`/runbooks/${runbookId}?tab=bindings`}>
                  <PlayCircle
                    className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                    aria-hidden="true"
                  />
                  <span>Run from a service</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 bg-border/60" />
            </>
          )}
          <DropdownMenuItem
            asChild
            className="rounded-xl px-2.5 py-2 text-xs font-medium cursor-pointer transition-colors hover:bg-muted/70 focus:bg-primary/10 focus:text-primary gap-2.5"
          >
            <Link href={`/runbooks/${runbookId}/compare`}>
              <GitCompare className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <span>Compare versions &amp; rule impact</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            asChild
            className="rounded-xl px-2.5 py-2 text-xs font-medium cursor-pointer transition-colors hover:bg-muted/70 focus:bg-primary/10 focus:text-primary gap-2.5"
          >
            <Link href={`/runbooks/executions?runbook=${runbookId}`}>
              <History className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <span>View all executions</span>
            </Link>
          </DropdownMenuItem>
          {(hasExport || duplicateAction) && (
            <DropdownMenuSeparator className="my-1 bg-border/60" />
          )}
          {hasExport && (
            <DropdownMenuLabel className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              Export &amp; copy
            </DropdownMenuLabel>
          )}
          {exportHref && (
            <DropdownMenuItem
              asChild
              className="rounded-xl px-2.5 py-2 text-xs font-medium cursor-pointer transition-colors hover:bg-muted/70 focus:bg-primary/10 focus:text-primary gap-2.5"
            >
              <a href={exportHref} download>
                <Download className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span>Export JSON</span>
              </a>
            </DropdownMenuItem>
          )}
          {draftExportHref && (
            <DropdownMenuItem
              asChild
              className="rounded-xl px-2.5 py-2 text-xs font-medium cursor-pointer transition-colors hover:bg-muted/70 focus:bg-primary/10 focus:text-primary gap-2.5"
            >
              <a href={draftExportHref} download>
                <Download className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span>Export draft JSON</span>
              </a>
            </DropdownMenuItem>
          )}
          {duplicateAction && (
            <DropdownMenuItem
              onSelect={() => setDuplicateOpen(true)}
              className="rounded-xl px-2.5 py-2 text-xs font-medium cursor-pointer transition-colors hover:bg-muted/70 focus:bg-primary/10 focus:text-primary gap-2.5"
            >
              <Copy className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <span>Duplicate…</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {duplicateAction && (
        <AlertDialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Duplicate {runbookName}?</AlertDialogTitle>
              <AlertDialogDescription>{duplicateDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <ActionForm
              action={duplicateAction}
              successMessage="Runbook duplicated"
              onSuccess={() => setDuplicateOpen(false)}
            >
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialogCancel>Keep unchanged</AlertDialogCancel>
                <SubmitButton variant="default" pendingLabel="Duplicating…">
                  Duplicate
                </SubmitButton>
              </div>
            </ActionForm>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
