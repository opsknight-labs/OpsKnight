'use client';
import { useEffect, useRef, useState } from 'react';
/** Form-level guidance mirrors activation's explicit supported-target contract. */
export default function AutomaticTargetGuard() {
  const node = useRef<HTMLDivElement>(null);
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    const form = node.current?.closest('form');
    if (!form) return;
    const refresh = () => {
      const values = new FormData(form);
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
      className="text-xs text-muted-foreground lg:col-span-4"
    >
      Automatic supports a specific Agent or a fixed pool without a label selector. Each eligible
      Agent needs a fresh successful policy check. Automatic certification supports at most 100
      online Agents per target. Use Suggested for dynamic or incident-dependent targets.
      {unsupported && (
        <p role="alert" className="text-destructive">
          This target is unsupported in Automatic mode. Choose a specific Agent, clear the pool
          selector, or switch to Suggested.
        </p>
      )}
    </div>
  );
}
