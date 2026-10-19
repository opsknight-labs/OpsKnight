'use client';

import { useId, useState } from 'react';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { parseAgentSelector } from './context-helpers';

const CONTEXT_REFERENCE = /\$\{\{\s*(?:context|automation)\./;

export default function AgentSelectorEditor({ defaultValue }: { defaultValue: string }) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const parsed = parseAgentSelector(value);

  const messages: Array<{ id: string; text: string }> = [];
  if (!parsed.ok) messages.push({ id: `${id}-json`, text: parsed.error });
  if (parsed.ok && Object.values(parsed.selector).some(item => CONTEXT_REFERENCE.test(item)))
    messages.push({
      id: `${id}-context`,
      text: 'Selectors cannot read automation context. Use the approved target mapping table.',
    });

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Agent selector (JSON)</Label>
      <Textarea
        id={id}
        name="agentSelector"
        aria-label="Agent selector"
        aria-invalid={messages.length > 0 || undefined}
        aria-describedby={[`${id}-help`, ...messages.map(message => message.id)].join(' ')}
        value={value}
        onChange={event => setValue(event.target.value)}
        className="min-h-20 font-mono text-xs"
      />
      <p id={`${id}-help`} className="text-[11px] text-muted-foreground">
        Static label → value pairs that narrow eligible Agents within the selected target.
      </p>
      {messages.map(message => (
        <p key={message.id} id={message.id} role="alert" className="text-xs text-destructive">
          {message.text}
        </p>
      ))}
    </div>
  );
}
