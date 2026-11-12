import type { UsageDay } from '@/lib/intelligence/ai/budget';

/**
 * A dependency-free bar chart backed by a real table, so the numbers are available to screen readers and
 * copyable, and nothing extra ships to the browser.
 */
export default function AiUsageChart({ history, budget }: { history: UsageDay[]; budget: number }) {
  const peak = Math.max(budget, ...history.map(day => day.tokens), 1);
  return (
    <div className="space-y-2 py-3">
      <div className="flex h-28 items-end gap-1" aria-hidden="true">
        {history.map(day => (
          <div key={day.day} className="flex h-full flex-1 flex-col justify-end" title={`${day.day}: ${day.tokens.toLocaleString('en-US')} tokens`}>
            <div
              className={day.tokens >= budget ? 'rounded-t bg-destructive' : 'rounded-t bg-primary/70'}
              style={{ height: `${Math.max(day.tokens > 0 ? 2 : 0, Math.round((day.tokens / peak) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <caption className="sr-only">AI usage per UTC day</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 font-medium">Day (UTC)</th>
              <th scope="col" className="py-1 text-right font-medium">Requests</th>
              <th scope="col" className="py-1 text-right font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {history.map(day => (
              <tr key={day.day} className="border-t border-border">
                <td className="py-1">{day.day}</td>
                <td className="py-1 text-right">{day.requests.toLocaleString('en-US')}</td>
                <td className="py-1 text-right">{day.tokens.toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
