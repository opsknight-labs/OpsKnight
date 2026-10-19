'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

export type RuleWizardStep = { title: string; description?: string; content: ReactNode };

const REVIEW_LABELS = new Map([
  ['mode', 'Execution mode'],
  ['versionStrategy', 'Version strategy'],
  ['runbookVersionId', 'Pinned version'],
  ['ruleName', 'Rule name'],
  ['enabled', 'Initial status'],
  ['executionTarget', 'Target'],
  ['agentSelector', 'Label selector'],
  ['initialTrigger', 'Trigger'],
]);

export default function RuleWizard({
  steps,
  summary = [],
  submit,
}: {
  steps: RuleWizardStep[];
  /** Review rows for values that are not form fields. */
  summary?: Array<[string, string]>;
  /** Final-step primary action, rendered in the sticky footer. */
  submit?: ReactNode;
}) {
  const [current, setCurrent] = useState(0);
  const [review, setReview] = useState<Array<[string, string]>>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const refresh = () => setInvalid(Boolean(node.querySelector('[data-form-invalid="true"]')));
    const observer = new MutationObserver(refresh);
    observer.observe(node, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-form-invalid'],
    });
    refresh();
    return () => observer.disconnect();
  }, []);
  function move(next: number) {
    if (next > current) {
      if (root.current?.querySelector('[data-form-invalid="true"]')) return;
      const fields = root.current?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(
        '[data-rule-wizard-step]:not([hidden]) input, [data-rule-wizard-step]:not([hidden]) select, [data-rule-wizard-step]:not([hidden]) textarea'
      );
      for (const field of fields ?? []) if (!field.reportValidity()) return;
    }
    if (next === steps.length - 1) {
      const form = root.current?.closest('form');
      if (form)
        setReview(
          Array.from(new FormData(form).entries())
            .filter(([name]) => REVIEW_LABELS.has(name) || name.startsWith('input:'))
            .map(([name, value]) => {
              const label = REVIEW_LABELS.get(name) ?? `Input: ${name.slice(6)}`;
              const field = form.elements.namedItem(name);
              const masked =
                name.startsWith('input:') &&
                (!(field instanceof HTMLElement) ||
                  field.dataset.reviewSensitive !== 'false' ||
                  (field instanceof HTMLInputElement && field.type === 'password'));
              const inputLabel =
                field instanceof HTMLElement ? field.getAttribute('aria-label') : null;
              const selectedText = document.getElementById(name)?.textContent;
              const text =
                name === 'agentSelector' && String(value) === '{}'
                  ? 'No label restriction'
                  : selectedText || String(value);
              return [inputLabel || label, masked ? 'Configured · Values masked in review' : text];
            })
        );
    }
    setCurrent(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  const step = steps.at(current);
  const last = current === steps.length - 1;
  const rows = [...summary, ...review];
  return (
    <div
      ref={root}
      className="flex min-w-0 flex-1 flex-col"
      onKeyDown={event => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !last)
          event.preventDefault();
      }}
    >
      <ol aria-label="Rule setup progress" className="flex items-start">
        {steps.map((item, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={item.title}
              aria-current={active ? 'step' : undefined}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
            >
              <div className="flex w-full items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    index === 0
                      ? 'opacity-0'
                      : done
                        ? 'bg-primary'
                        : active
                          ? 'bg-primary/40'
                          : 'bg-border/70 dark:bg-border/50'
                  )}
                />
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => move(index)}
                  aria-label={`Step ${index + 1}: ${item.title}${done ? ' · completed, go back' : ''}`}
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-4 ring-background shadow-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                    done && 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs',
                    active && 'bg-primary/10 text-primary border border-primary/30',
                    !done && !active && 'bg-muted/60 text-muted-foreground border border-border/70'
                  )}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
                </button>
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    index === steps.length - 1
                      ? 'opacity-0'
                      : done
                        ? 'bg-primary'
                        : 'bg-border/70 dark:bg-border/50'
                  )}
                />
              </div>
              <span
                aria-hidden
                className={cn(
                  'hidden px-1 text-[11px] leading-tight sm:block',
                  active ? 'font-semibold text-foreground' : 'text-muted-foreground'
                )}
              >
                {item.title}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
          Step {current + 1} of {steps.length}
        </p>
        <h3
          ref={heading}
          tabIndex={-1}
          id={id}
          className="!text-base !leading-snug font-semibold tracking-tight outline-none"
        >
          {step?.title}
        </h3>
        {step?.description && (
          <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
        )}
      </div>

      {last && rows.length > 0 && (
        <dl
          aria-label="Rule configuration review"
          className="mt-4 divide-y rounded-xl border bg-muted/20 text-sm"
        >
          {rows.map(([name, value], index) => (
            <div
              key={`${name}-${index}`}
              className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-4"
            >
              <dt className="break-words text-xs font-medium text-muted-foreground">{name}</dt>
              <dd className="break-all text-foreground">{value || 'Not configured'}</dd>
            </div>
          ))}
        </dl>
      )}

      {steps.map((item, index) => (
        <div
          data-rule-wizard-step
          key={item.title}
          hidden={index !== current}
          aria-labelledby={id}
          className="mt-4 space-y-4 pb-6"
        >
          {item.content}
        </div>
      ))}

      <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        {current > 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="gap-1.5"
            onClick={() => move(current - 1)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Button>
        ) : (
          <span aria-hidden />
        )}
        {last ? (
          submit
        ) : (
          <Button
            type="button"
            disabled={invalid}
            className="gap-1.5"
            onClick={() => move(current + 1)}
          >
            Continue to {steps[current + 1]?.title.toLowerCase()}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
