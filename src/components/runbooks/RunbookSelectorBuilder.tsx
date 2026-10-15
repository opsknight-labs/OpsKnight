'use client';
import { useId, useState } from 'react';
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
    <fieldset className="space-y-2 min-w-0" data-form-invalid={valid ? undefined : 'true'}>
      <legend className="text-sm font-medium">Agent label selector</legend>
      <p className="text-xs text-muted-foreground">
        Match all labels. An empty selector adds no label restriction; Agent or pool scope still
        applies. Machine-specific writes require one resolved Agent.
      </p>
      <input
        type="hidden"
        name="agentSelector"
        value={valid ? JSON.stringify(parsed.data) : '__invalid_selector__'}
      />
      {advanced ? (
        <>
          <Label htmlFor={`${id}-raw`}>Advanced selector JSON</Label>
          <Textarea
            aria-invalid={!valid}
            aria-describedby={!valid ? `${id}-error` : undefined}
            id={`${id}-raw`}
            value={raw}
            onChange={event => setRaw(event.target.value)}
          />
        </>
      ) : (
        rows.map((row, index) => (
          <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <Label htmlFor={`${row.id}-key`}>Label {index + 1} key</Label>
              <Input
                id={`${row.id}-key`}
                value={row.key}
                onChange={event =>
                  setRows(current =>
                    current.map(item =>
                      item.id === row.id ? { ...item, key: event.target.value } : item
                    )
                  )
                }
              />
            </div>
            <div>
              <Label htmlFor={`${row.id}-value`}>Label {index + 1} value</Label>
              <Input
                id={`${row.id}-value`}
                value={row.value}
                onChange={event =>
                  setRows(current =>
                    current.map(item =>
                      item.id === row.id ? { ...item, value: event.target.value } : item
                    )
                  )
                }
              />
            </div>
            <Button
              type="button"
              variant="outline"
              aria-label={`Remove label ${index + 1}`}
              onClick={() => setRows(current => current.filter(item => item.id !== row.id))}
            >
              Remove
            </Button>
          </div>
        ))
      )}
      {!advanced && (
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= 32}
          onClick={() =>
            setRows(current => [...current, { id: crypto.randomUUID(), key: '', value: '' }])
          }
        >
          Add selector label
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
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
        {advanced ? 'Use label fields' : 'Use advanced JSON'}
      </Button>
      {!valid && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          Selector must contain at most 32 unique valid label keys and string values. Saving is
          rejected until corrected.
        </p>
      )}
    </fieldset>
  );
}
