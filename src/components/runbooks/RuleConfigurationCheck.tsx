'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';

export default function RuleConfigurationCheck({
  action,
}: {
  action: () => Promise<BindingReadiness>;
}) {
  const [result, setResult] = useState<BindingReadiness>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          setError('');
          try {
            setResult(await action());
          } catch {
            setError('Configuration could not be checked. Retry after dependencies recover.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Checking configuration…' : 'Validate configuration · No execution'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="rounded border p-3 text-sm space-y-1">
          <p>
            {result.state.replaceAll('_', ' ')} · {result.checkedAt}
          </p>
          {result.checks.map(check => (
            <p key={check.code}>
              {check.state}: {check.message}
            </p>
          ))}
          <p>This check does not activate the rule or perform actions.</p>
        </div>
      )}
    </div>
  );
}
