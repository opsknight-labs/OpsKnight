'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
/** Form-level guidance mirrors activation's explicit supported-target contract. */
export default function AutomaticTargetGuard() {
  const node = useRef<HTMLDivElement>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  useEffect(() => {
    const form = node.current?.closest('form');
    if (!form) return;
    const refresh = () => {
      const values = new FormData(form);
      setAutomatic(values.get('mode') === 'AUTOMATIC');
      let selector: Record<string, unknown> = {};
      try {
        selector = JSON.parse(String(values.get('agentSelector') || '{}'));
      } catch {
        return;
      }
      const entries = Object.entries(selector);
      setUnsupported(
        values.get('mode') === 'AUTOMATIC' &&
          (entries.some(([, value]) => String(value).includes('incident.labels.')) ||
            (entries.length > 0 && !String(values.get('executionTarget')).startsWith('agent:')))
      );
    };
    const observer = new MutationObserver(refresh);
    observer.observe(form, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['value'],
    });
    form.addEventListener('change', refresh);
    refresh();
    return () => {
      observer.disconnect();
      form.removeEventListener('change', refresh);
    };
  }, []);
  return (
    <div
      ref={node}
      data-form-invalid={unsupported ? 'true' : undefined}
      className={cn(
        'col-span-full rounded-lg px-3 py-2 text-xs ring-1 ring-inset',
        unsupported
          ? 'bg-destructive/5 text-destructive ring-destructive/25'
          : 'bg-primary/5 text-muted-foreground ring-primary/15',
        !automatic && !unsupported && 'hidden'
      )}
    >
      {unsupported ? (
        <p role="alert" className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            This target is unsupported in Automatic mode. Choose a specific Agent, clear the pool
            selector, or switch to Suggested.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span>
            Automatic needs a specific Agent or a fixed pool without labels (up to 100 online
            Agents), each with a fresh policy check. Use Suggested for dynamic targets.
          </span>
        </p>
      )}
    </div>
  );
}
