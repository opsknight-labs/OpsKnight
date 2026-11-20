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
        <DropdownMenuContent align="end">
          {canRun && (
            <>
              <DropdownMenuItem asChild>
                <Link href={`/runbooks/${runbookId}?tab=bindings`}>
                  <PlayCircle aria-hidden="true" />
                  <span>Run from a service</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/runbooks/${runbookId}/compare`}>
              <GitCompare aria-hidden="true" />
              <span>Compare versions &amp; rule impact</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/runbooks/executions?runbook=${runbookId}`}>
              <History aria-hidden="true" />
              <span>View all executions</span>
            </Link>
          </DropdownMenuItem>
          {(hasExport || duplicateAction) && <DropdownMenuSeparator />}
          {hasExport && <DropdownMenuLabel>Export &amp; copy</DropdownMenuLabel>}
          {exportHref && (
            <DropdownMenuItem asChild>
              <a href={exportHref} download>
                <Download aria-hidden="true" />
                <span>Export JSON</span>
              </a>
            </DropdownMenuItem>
          )}
          {draftExportHref && (
            <DropdownMenuItem asChild>
              <a href={draftExportHref} download>
                <Download aria-hidden="true" />
                <span>Export draft JSON</span>
              </a>
            </DropdownMenuItem>
          )}
          {duplicateAction && (
            <DropdownMenuItem onSelect={() => setDuplicateOpen(true)}>
              <Copy aria-hidden="true" />
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
