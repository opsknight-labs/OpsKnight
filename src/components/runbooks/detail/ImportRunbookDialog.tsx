'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { importRunbookAction } from '@/app/(app)/runbooks/[id]/version-actions';
import {
  ActionForm,
  SubmitButton,
  type RunbookFormAction,
} from '@/components/runbooks/RunbookControls';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { notify } from '@/lib/toast';

const MAX_IMPORT_BYTES = 512 * 1024;

export function ImportRunbookDialog({
  action = importRunbookAction,
  triggerLabel = 'Import',
}: {
  action?: RunbookFormAction;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import runbook</DialogTitle>
          <DialogDescription>
            Upload an exported <code className="text-xs">.runbook.json</code> file or paste its
            contents. The runbook is created as a new draft; nothing is published or executed.
          </DialogDescription>
        </DialogHeader>
        <ActionForm
          action={action}
          className="space-y-4"
          successMessage="Runbook imported"
          onSuccess={() => setOpen(false)}
        >
          <div className="space-y-2">
            <Label htmlFor="runbook-import-file">Runbook file</Label>
            <Input
              id="runbook-import-file"
              name="file"
              type="file"
              accept=".json,application/json"
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                if (file && file.size > MAX_IMPORT_BYTES) {
                  notify.error('Runbook files must be 512 KiB or smaller.');
                  event.currentTarget.value = '';
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="runbook-import-json">Or paste JSON</Label>
            <Textarea
              id="runbook-import-json"
              name="json"
              rows={6}
              maxLength={MAX_IMPORT_BYTES}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder='{ "format": "opsknight.runbook", "formatVersion": 1, … }'
            />
          </div>
          <p className="text-xs text-muted-foreground">
            If the slug is already taken, a numbered suffix is added automatically.
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Importing…">Import runbook</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
