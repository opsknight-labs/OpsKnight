'use client';
import { useId, useState } from 'react';
import { Braces, List as ListIcon, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import { parseAgentSelector } from '@/lib/runbooks/selector-input';
import { schedulingLabelsSchema } from '@/lib/runbooks/labels';
export default function RunbookSelectorBuilder({ initialValue = {} }: { initialValue?: unknown }) {
  const id = useId();
  const [rows, setRows] = useState<Array<{ id: string; key: string; value: string }>>(() => {
    const parsed = schedulingLabelsSchema.safeParse(initialValue);
    return parsed.success
      ? Object.entries(parsed.data).map(([key, value], index) => ({
          id: `${id}-${index}`,
          key,
          value,
        }))
      : [];
  });
  const [advanced, setAdvanced] = useState(false);
  const [raw, setRaw] = useState(JSON.stringify(initialValue, null, 2));
  const duplicate = new Set(rows.map(row => row.key.trim())).size !== rows.length;
  const structured = Object.fromEntries(
    rows.filter(row => row.key.trim()).map(row => [row.key.trim(), row.value])
  );
  let candidate: unknown = structured;
  let parseError = false;
  if (advanced) {
    try {
      candidate = JSON.parse(raw);
    } catch {
      parseError = true;
    }
  }
  const parsed = advanced ? parseAgentSelector(raw) : schedulingLabelsSchema.safeParse(candidate);
  const valid =
    !parseError &&
    parsed.success &&
    (advanced || (!duplicate && !rows.some(row => !row.key.trim())));
  return (
    <fieldset
      className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-4"
      data-form-invalid={valid ? undefined : 'true'}
    >
      <legend className="sr-only">Agent label selector</legend>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p aria-hidden className="text-sm font-medium">
            Agent label selector
          </p>
          <p className="pt-0.5 text-xs text-muted-foreground">
            Optional. Agents must match every label. Leave empty to use the target as-is.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => {
            if (!advanced) setRaw(JSON.stringify(structured, null, 2));
            else if (parsed.success)
              setRows(
                Object.entries(parsed.data).map(([key, value]) => ({
                  id: crypto.randomUUID(),
                  key,
                  value,
                }))
              );
            setAdvanced(!advanced);
          }}
        >
          {advanced ? (
            <ListIcon className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Braces className="h-3.5 w-3.5" aria-hidden />
          )}
          {advanced ? 'Use label fields' : 'Use advanced JSON'}
        </Button>
      </div>
      <input
        type="hidden"
        name="agentSelector"
        value={valid ? JSON.stringify(parsed.data) : '__invalid_selector__'}
      />
      {advanced ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-raw`}>Advanced selector JSON</Label>
          <Textarea
            aria-invalid={!valid}
            aria-describedby={!valid ? `${id}-error` : undefined}
            id={`${id}-raw`}
            value={raw}
            onChange={event => setRaw(event.target.value)}
            className="font-mono text-xs"
          />
        </div>
      ) : (
        rows.length > 0 && (
          <div className="space-y-2">
            <div
              aria-hidden
              className="hidden grid-cols-[1fr_1fr_2.25rem] gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid"
            >
              <span>Key</span>
              <span>Value</span>
            </div>
            {rows.map((row, index) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_2.25rem] items-center gap-2">
                <Label htmlFor={`${row.id}-key`} className="sr-only">
                  Label {index + 1} key
                </Label>
                <Input
                  id={`${row.id}-key`}
                  placeholder="environment"
                  value={row.key}
                  onChange={event =>
                    setRows(current =>
                      current.map(item =>
                        item.id === row.id ? { ...item, key: event.target.value } : item
                      )
                    )
                  }
                />
                <Label htmlFor={`${row.id}-value`} className="sr-only">
                  Label {index + 1} value
                </Label>
                <Input
                  id={`${row.id}-value`}
                  placeholder="production"
                  value={row.value}
                  onChange={event =>
                    setRows(current =>
                      current.map(item =>
                        item.id === row.id ? { ...item, value: event.target.value } : item
                      )
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove label ${index + 1}`}
                  onClick={() => setRows(current => current.filter(item => item.id !== row.id))}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )
      )}
      {!advanced && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={rows.length >= 32}
          onClick={() =>
            setRows(current => [...current, { id: crypto.randomUUID(), key: '', value: '' }])
          }
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add selector label
        </Button>
      )}
      {!valid && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          Selector must contain at most 32 unique valid label keys and string values. Saving is
          rejected until corrected.
        </p>
      )}
    </fieldset>
  );
}
