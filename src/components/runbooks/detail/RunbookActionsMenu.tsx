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
          <Button variant="outline" size="sm" aria-label="More runbook actions">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {canRun && (
            <>
              <DropdownMenuItem asChild>
                <Link href={`/runbooks/${runbookId}?tab=bindings`}>
                  <PlayCircle className="h-4 w-4" aria-hidden="true" />
                  Run from a service
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/runbooks/${runbookId}/compare`}>
              <GitCompare className="h-4 w-4" aria-hidden="true" />
              Compare versions &amp; rule impact
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/runbooks/executions?runbook=${runbookId}`}>
              <History className="h-4 w-4" aria-hidden="true" />
              View all executions
            </Link>
          </DropdownMenuItem>
          {(hasExport || duplicateAction) && <DropdownMenuSeparator />}
          {hasExport && (
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              Export &amp; copy
            </DropdownMenuLabel>
          )}
          {exportHref && (
            <DropdownMenuItem asChild>
              <a href={exportHref} download>
                <Download className="h-4 w-4" aria-hidden="true" />
                Export JSON
              </a>
            </DropdownMenuItem>
          )}
          {draftExportHref && (
            <DropdownMenuItem asChild>
              <a href={draftExportHref} download>
                <Download className="h-4 w-4" aria-hidden="true" />
                Export draft JSON
              </a>
            </DropdownMenuItem>
          )}
          {duplicateAction && (
            <DropdownMenuItem onSelect={() => setDuplicateOpen(true)}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Duplicate…
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
