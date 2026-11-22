'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { notify } from '@/lib/toast';
import { importBusinessServicesAction } from '@/app/(app)/services/business/setup/actions';
import type { ImportFormat, ImportPlan } from '@/lib/business-services/import';

const FORMATS: Array<{ value: ImportFormat; label: string; example: string }> = [
  {
    value: 'csv',
    label: 'CSV',
    example:
      'name,description,criticality,owner_team,members,depends_on\nCheckout,Paying for an order,TIER_0,Payments,checkout-api;payments-api,Payments',
  },
  {
    value: 'yaml',
    label: 'YAML',
    example:
      'businessServices:\n  - name: Checkout\n    criticality: TIER_0\n    ownerTeam: Payments\n    members: [checkout-api, payments-api]\n    dependsOn: [Payments]',
  },
  {
    value: 'backstage',
    label: 'Backstage catalog',
    example:
      'kind: System\nmetadata: { name: checkout }\n---\nkind: Component\nmetadata: { name: checkout-api }\nspec: { system: checkout }',
  },
];

const ACTION_LABEL = { create: 'New', update: 'Changes', unchanged: 'Unchanged' } as const;

/**
 * "Import" secondary action for the business-service catalog: paste or upload CSV, YAML or a
 * Backstage catalog, review the dry-run diff, then apply it all at once.
 */
export default function ImportBusinessServicesButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [content, setContent] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const example = FORMATS.find(item => item.value === format)!.example;

  const run = (dryRun: boolean) =>
    startTransition(async () => {
      setError(null);
      const response = await importBusinessServicesAction({ format, content, dryRun });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setPlan(response.result);
      if (response.result.applied) {
        const { create, update } = response.result.summary;
        notify.success(`Imported: ${create} new, ${update} updated`);
        setOpen(false);
        setPlan(null);
        setContent('');
        router.refresh();
      }
    });

  const reset = (next: string) => {
    setContent(next);
    setPlan(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Upload className="h-4 w-4" aria-hidden />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import business services</DialogTitle>
          <DialogDescription>
            Up to 1000 at a time. Rows match existing business services by name; blank fields stay
            as they are. Nothing changes until you apply the preview.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bs-import-format">Format</Label>
            <Select
              value={format}
              onValueChange={value => {
                setFormat(value as ImportFormat);
                setPlan(null);
              }}
            >
              <SelectTrigger id="bs-import-format" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-import-file">File</Label>
            <input
              id="bs-import-file"
              type="file"
              accept=".csv,.yaml,.yml,.json,text/csv,text/yaml"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:text-foreground"
              onChange={async event => {
                const file = event.target.files?.[0];
                if (file) reset(await file.text());
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-import-content">Or paste it</Label>
            <Textarea
              id="bs-import-content"
              value={content}
              rows={8}
              placeholder={example}
              className="font-mono text-xs"
              onChange={event => reset(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {plan && <ImportPreview plan={plan} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {plan && !plan.issues.length ? (
            <Button
              type="button"
              disabled={pending || plan.summary.create + plan.summary.update === 0}
              onClick={() => run(false)}
            >
              {pending ? 'Applying…' : 'Apply import'}
            </Button>
          ) : (
            <Button type="button" disabled={pending || !content.trim()} onClick={() => run(true)}>
              {pending ? 'Checking…' : 'Preview changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The dry-run diff: issues first (they block the apply), then each row's change. */
export function ImportPreview({ plan }: { plan: ImportPlan }) {
  const { summary } = plan;
  return (
    <section aria-label="Import preview" className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">
        {summary.create} new · {summary.update} changed · {summary.unchanged} unchanged
        {plan.issues.length ? ` · ${plan.issues.length} to fix` : ''}
      </p>
      {plan.issues.length > 0 && (
        <ul className="space-y-1 text-xs text-destructive" aria-label="Problems to fix">
          {plan.issues.map((issue, index) => (
            <li key={index}>
              {issue.line ? `Line ${issue.line}: ` : ''}
              {issue.name ? `${issue.name}: ` : ''}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      <ul className="max-h-60 divide-y divide-border overflow-y-auto text-xs" aria-label="Changes">
        {plan.changes.map(change => (
          <li key={`${change.line}-${change.name}`} className="flex flex-wrap gap-x-2 py-1.5">
            <span className="font-medium text-foreground">{change.name}</span>
            <span className="text-muted-foreground">{ACTION_LABEL[change.action]}</span>
            {change.fields.length > 0 && change.action === 'update' && (
              <span className="text-muted-foreground">({change.fields.join(', ')})</span>
            )}
            {change.membersAdded.length > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400">
                + {change.membersAdded.join(', ')}
              </span>
            )}
            {change.membersRemoved.length > 0 && (
              <span className="text-destructive">− {change.membersRemoved.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
