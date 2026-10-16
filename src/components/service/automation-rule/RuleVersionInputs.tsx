import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { ChecksumCopy } from './ChecksumCopy';
import { shortChecksum, type RuleInputRow } from './rule-presentation';

export function RuleVersionInputs({
  runbookId,
  version,
  strategy,
  checksum,
  inputs,
  rawInputs,
}: {
  runbookId: string;
  version: number | null;
  strategy: string;
  checksum: string | null;
  inputs: RuleInputRow[];
  rawInputs: string;
}) {
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/20 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Version</dt>
          <dd className="text-sm font-semibold">
            {version === null ? 'Unavailable' : `v${version}`}
          </dd>
        </div>
        <div className="rounded-lg border bg-muted/20 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Strategy</dt>
          <dd className="text-sm font-semibold capitalize">{strategy}</dd>
        </div>
        <div className="rounded-lg border bg-muted/20 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Checksum</dt>
          <dd className="flex items-center justify-between gap-2">
            <code className="truncate font-mono text-sm" title={checksum ?? undefined}>
              {shortChecksum(checksum)}
            </code>
            {checksum && <ChecksumCopy value={checksum} />}
          </dd>
        </div>
      </dl>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Rule inputs</h3>
          <Link href={`/runbooks/${runbookId}`} className="text-xs text-primary hover:underline">
            Review workflow, inputs and version impact
          </Link>
        </div>
        {inputs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No inputs configured.</p>
        ) : (
          <dl className="divide-y rounded-lg border">
            {inputs.map(input => (
              <div
                key={input.key}
                className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4"
              >
                <dt className="min-w-0">
                  <span className="font-medium">{input.label}</span>
                  {input.label !== input.key && (
                    <code className="ml-2 font-mono text-xs text-muted-foreground">
                      {input.key}
                    </code>
                  )}
                </dt>
                <dd className="flex min-w-0 items-center gap-1.5 break-all text-muted-foreground">
                  {input.secret && <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  {input.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">
          Secret values and references remain masked in service summaries.
        </p>
      </div>
      <details className="group rounded-lg border">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 py-3 text-sm font-medium">
          Review resolved rule inputs
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border-t bg-muted/30 p-3 font-mono text-xs">
          {rawInputs}
        </pre>
      </details>
    </>
  );
}
