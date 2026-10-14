'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/shadcn/button';

export default function RuleWizard({
  steps,
}: {
  steps: Array<{ title: string; content: ReactNode }>;
}) {
  const [current, setCurrent] = useState(0);
  const [review, setReview] = useState<Array<[string, string]>>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  function move(next: number) {
    if (next > current) {
      const fields = root.current?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(
        '[data-rule-wizard-step]:not([hidden]) input, [data-rule-wizard-step]:not([hidden]) select, [data-rule-wizard-step]:not([hidden]) textarea'
      );
      for (const field of fields ?? []) if (!field.reportValidity()) return;
    }
    if (next === steps.length - 1) {
      const form = root.current?.closest('form');
      const labels = new Map([
        ['ruleName', 'Rule name'],
        ['mode', 'Execution mode'],
        ['versionStrategy', 'Version strategy'],
        ['runbookVersionId', 'Version'],
        ['executionTarget', 'Target'],
        ['agentSelector', 'Label selector'],
        ['initialTrigger', 'Trigger'],
        ['enabled', 'Initial status'],
      ]);
      if (form)
        setReview(
          Array.from(new FormData(form).entries())
            .filter(([name]) => labels.has(name) || name.startsWith('input:'))
            .map(([name, value]) => {
              const label = labels.get(name) ?? `Input: ${name.slice(6)}`;
              const masked = name.startsWith('input:');
              const selectedText = document.getElementById(name)?.textContent;
              return [
                label,
                masked ? 'Configured · Values masked in review' : selectedText || String(value),
              ];
            })
        );
    }
    setCurrent(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <div
      ref={root}
      className="space-y-4 min-w-0"
      onKeyDown={event => {
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLInputElement &&
          current < steps.length - 1
        )
          event.preventDefault();
      }}
    >
      <ol aria-label="Rule setup progress" className="flex flex-wrap gap-2 text-sm">
        {steps.map((step, index) => (
          <li
            key={step.title}
            aria-current={index === current ? 'step' : undefined}
            className={index === current ? 'font-semibold text-primary' : 'text-muted-foreground'}
          >
            {index + 1}. {step.title}
          </li>
        ))}
      </ol>
      <h3 ref={heading} tabIndex={-1} id={id} className="font-semibold outline-none">
        {steps.at(current)?.title}
      </h3>
      {current === steps.length - 1 && review.length > 0 && (
        <dl aria-label="Rule configuration review" className="rounded border p-3 text-sm space-y-2">
          {review.map(([name, value], index) => (
            <div key={`${name}-${index}`} className="grid gap-1 sm:grid-cols-2">
              <dt className="font-medium break-words">{name}</dt>
              <dd className="break-all text-muted-foreground">{value || 'Not configured'}</dd>
            </div>
          ))}
        </dl>
      )}
      {steps.map((step, index) => (
        <div
          data-rule-wizard-step
          key={step.title}
          hidden={index !== current}
          aria-labelledby={id}
          className="space-y-3"
        >
          {step.content}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {current > 0 && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => move(current - 1)}
          >
            Back
          </Button>
        )}
        {current < steps.length - 1 && (
          <Button type="button" className="min-h-11" onClick={() => move(current + 1)}>
            Continue to {steps[current + 1]?.title.toLowerCase()}
          </Button>
        )}
      </div>
    </div>
  );
}
