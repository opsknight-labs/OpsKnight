'use client';

import { useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { CheckCircle2, AlertCircle, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

type JsonStatus = { ok: true } | { ok: false; message: string; line?: number };

function inspectJson(text: string): JsonStatus {
  if (!text.trim()) return { ok: false, message: 'JSON is empty.' };
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    const position = /position (\d+)/.exec(message);
    const line = position ? text.slice(0, Number(position[1])).split('\n').length : undefined;
    return { ok: false, message, line };
  }
}

export function JsonCodeEditor({
  value,
  onChange,
  label,
  readOnly,
  minRows = 12,
  validate,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  readOnly?: boolean;
  minRows?: number;
  /** Returns a schema problem for syntactically valid JSON, or null. */
  validate?: (parsed: unknown) => string | null;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const statusId = useId();
  const lineCount = Math.max(value.split('\n').length, minRows);
  const syntax = useMemo(() => inspectJson(value), [value]);
  const status = useMemo<JsonStatus>(() => {
    if (!syntax.ok || !validate) return syntax;
    const problem = validate(JSON.parse(value));
    return problem ? { ok: false, message: problem } : syntax;
  }, [syntax, value, validate]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || readOnly) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + 2;
    });
  };

  const format = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      // Status already explains the syntax error.
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20 focus-within:ring-2 focus-within:ring-ring">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={format}
            disabled={!syntax.ok}
          >
            <WrapText className="h-3.5 w-3.5" aria-hidden />
            Format
          </Button>
        )}
      </div>
      <div className="flex max-h-[32rem] overflow-hidden">
        <div
          ref={gutterRef}
          aria-hidden
          className="select-none overflow-hidden border-r bg-muted/30 px-2 py-2 text-right font-mono text-xs leading-5 text-muted-foreground"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div
              key={index}
              className={cn(
                !status.ok && status.line === index + 1 && 'font-semibold text-destructive'
              )}
            >
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          aria-label={label}
          aria-invalid={!status.ok}
          aria-describedby={statusId}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={lineCount}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={event => {
            if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          className="flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none"
        />
      </div>
      <div
        id={statusId}
        aria-live="polite"
        className={cn(
          'flex items-center gap-1.5 border-t px-3 py-1.5 text-xs',
          status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
        )}
      >
        {status.ok ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Valid JSON
          </>
        ) : (
          <>
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            {status.line ? `Line ${status.line}: ` : ''}
            {status.message}
          </>
        )}
      </div>
    </div>
  );
}
