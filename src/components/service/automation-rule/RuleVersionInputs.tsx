import Link from 'next/link';
import { ChevronDown, Code2, KeyRound } from 'lucide-react';
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
    <div className="space-y-4">
      <dl className="grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs p-3 shadow-2xs">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Version
          </dt>
          <dd className="mt-0.5 text-sm font-bold text-foreground">
            {version === null ? 'Unavailable' : `v${version}`}
          </dd>
        </div>
        <div className="rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs p-3 shadow-2xs">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Strategy
          </dt>
          <dd className="mt-0.5 text-sm font-bold text-foreground capitalize">{strategy}</dd>
        </div>
        <div className="rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs p-3 shadow-2xs">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Definition Checksum
          </dt>
          <dd className="mt-0.5 flex items-center justify-between gap-2">
            <code
              className="truncate font-mono text-xs font-semibold text-foreground"
              title={checksum ?? undefined}
            >
              {shortChecksum(checksum)}
            </code>
            {checksum && <ChecksumCopy value={checksum} />}
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Rule Inputs ({inputs.length})
          </h3>
          <Link
            href={`/runbooks/${runbookId}`}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Review master workflow inputs →
          </Link>
        </div>
        {inputs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-center">
            <p className="text-xs text-muted-foreground">No custom inputs configured.</p>
          </div>
        ) : (
          <dl className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs shadow-2xs overflow-hidden">
            {inputs.map(input => (
              <div
                key={input.key}
                className="grid gap-1 px-3.5 py-2.5 text-xs sm:text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4 items-center"
              >
                <dt className="min-w-0">
                  <span className="font-semibold text-foreground">{input.label}</span>
                  {input.label !== input.key && (
                    <code className="ml-2 rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {input.key}
                    </code>
                  )}
                </dt>
                <dd className="flex min-w-0 items-center gap-1.5 break-all text-muted-foreground font-mono text-xs">
                  {input.secret && (
                    <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                  )}
                  <span className="truncate">{input.value}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-[11px] text-muted-foreground">
          Secret values and environment references remain masked in service summaries.
        </p>
      </div>

      <details className="group rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs shadow-2xs overflow-hidden [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex min-h-10 cursor-pointer items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <span className="flex items-center gap-2">
            <Code2 className="h-3.5 w-3.5" />
            <span>Review resolved rule configuration JSON</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border-t border-border/60 bg-muted/30 p-3.5 font-mono text-xs leading-relaxed text-foreground">
          {rawInputs}
        </pre>
      </details>
    </div>
  );
}
