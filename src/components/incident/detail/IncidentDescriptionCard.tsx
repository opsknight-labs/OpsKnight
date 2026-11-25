'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  useMemo,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import CopyButton from '@/components/common/CopyButton';
import type { ReadablePayload } from '@/lib/payload-reader/types';
import ReadablePayloadView from './ReadablePayloadView';
import { FileText, Edit2, Check, X, Loader2, ChevronDown, ChevronUp, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type IncidentDescriptionCardProps = {
  incidentId: string;
  description: string | null;
  canManage: boolean;
  onUpdateDescription?: (newDescription: string) => Promise<void>;
  className?: string;
  /** Rendered inside the card under the description, e.g. the incident context from the alert. */
  /** Verified incident context, shown above the description. */
  context?: ReactNode;
  /** The description read as an alert payload (server-built, no AI); shown instead of raw text when structured. */
  readable?: ReadablePayload | null;
  /** Start as a summary (context and the top of the alert) with "Show full alert"; remembered per browser. */
  clamp?: boolean;
};

/** Summary height: context pills, source, alert title and key metric. */
const CLAMP_PX = 208;
const FULL_KEY = 'opsknight.incident.descriptionFull';
const FULL_EVENT = 'opsknight:description-full';

function subscribeFull(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(FULL_EVENT, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(FULL_EVENT, notify);
  };
}

function readFull(): boolean {
  try {
    const stored = localStorage.getItem(FULL_KEY);
    if (stored !== null) return stored === '1';
  } catch {
    // Storage blocked: use this page's own choice below.
  }
  return fullFallback;
}

/** This page's choice when storage is blocked. */
let fullFallback = false;
function writeFull(next: boolean) {
  fullFallback = next;
  try {
    localStorage.setItem(FULL_KEY, next ? '1' : '0');
  } catch {
    // Not remembered across visits; fullFallback keeps it for this page.
  }
  window.dispatchEvent(new Event(FULL_EVENT));
}

// Check if string is raw JSON
function tryParseJson(text: string): string | null {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  }
  return null;
}

function renderJsonValue(val: string): ReactNode {
  const trimmed = val.trim();
  const hasComma = trimmed.endsWith(',');
  const cleanVal = hasComma ? trimmed.slice(0, -1) : trimmed;

  let node: ReactNode;
  if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
    node = <span className="text-emerald-700 dark:text-emerald-400 font-normal">{cleanVal}</span>;
  } else if (cleanVal.length > 0 && !Number.isNaN(Number(cleanVal))) {
    node = <span className="text-amber-700 dark:text-amber-400 font-medium">{cleanVal}</span>;
  } else if (cleanVal === 'true' || cleanVal === 'false') {
    node = <span className="text-violet-700 dark:text-violet-400 font-semibold">{cleanVal}</span>;
  } else if (cleanVal === 'null') {
    node = <span className="text-rose-700 dark:text-rose-400 italic">null</span>;
  } else {
    node = <span className="text-foreground/80">{cleanVal}</span>;
  }

  return (
    <>
      {node}
      {hasComma && <span className="text-muted-foreground">,</span>}
    </>
  );
}

/**
 * ClickHouse prints Map, Array and Tuple values as `{'k':1}`, `['a','b']` and
 * `('x',1)`. Grafana passes them through as text, so rewrite them as JSON.
 */
export function clickHouseLiteralToJson(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[[{(][\s\S]*[\]})]$/.test(trimmed)) return null;
  let out = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charAt(i);
    if (ch === "'") {
      let value = '';
      for (i++; i < trimmed.length && trimmed.charAt(i) !== "'"; i++) {
        value += trimmed.charAt(i) === '\\' ? trimmed.charAt(++i) : trimmed.charAt(i);
      }
      out += JSON.stringify(value);
    } else {
      out += ch === '(' ? '[' : ch === ')' ? ']' : ch;
    }
  }
  try {
    return JSON.stringify(JSON.parse(out), null, 2);
  } catch {
    return null;
  }
}

/**
 * A JSON string value that hides structure: multi-line text (ClickHouse query
 * output, templated annotations), embedded JSON, or a ClickHouse literal.
 * Returns the text to show expanded under its key, or null to keep it inline.
 */
export function expandStringValue(literal: string): { kind: 'json' | 'text'; text: string } | null {
  if (!literal.startsWith('"') || !literal.endsWith('"')) return null;
  let decoded: string;
  try {
    decoded = JSON.parse(literal);
  } catch {
    return null;
  }
  const json = tryParseJson(decoded) ?? clickHouseLiteralToJson(decoded);
  if (json) return { kind: 'json', text: json };
  if (decoded.includes('\n')) return { kind: 'text', text: decoded.replace(/\s+$/, '') };
  return null;
}

function renderJsonLines(jsonStr: string): ReactNode[] {
  const lines = jsonStr.split('\n');
  return lines.map((line, idx) => {
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const content = line.slice(indent.length);

    const kvMatch = content.match(/^("([^"\\]|\\.)*")\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[3];
      const hasComma = val.trim().endsWith(',');
      const expanded = expandStringValue(hasComma ? val.trim().slice(0, -1) : val.trim());
      const keyNode = (
        <>
          <span>{indent}</span>
          <span className="text-sky-700 dark:text-sky-300 font-semibold">{key}</span>
          <span className="text-muted-foreground">: </span>
        </>
      );
      if (expanded) {
        const nested = `${indent}  `;
        return (
          <div key={idx} className="leading-snug">
            <div>{keyNode}</div>
            {expanded.kind === 'json'
              ? renderJsonLines(
                  expanded.text
                    .split('\n')
                    .map(l => nested + l)
                    .join('\n')
                )
              : expanded.text.split('\n').map((textLine, lineIdx) => (
                  <div key={lineIdx} className="text-emerald-700 dark:text-emerald-400">
                    {nested}
                    {textLine}
                  </div>
                ))}
          </div>
        );
      }
      return (
        <div key={idx} className="leading-snug">
          {keyNode}
          {renderJsonValue(val)}
        </div>
      );
    }

    return (
      <div key={idx} className="leading-snug">
        <span>{indent}</span>
        {renderJsonValue(content)}
      </div>
    );
  });
}

// Universal parser for markdown, code fences, key-value alerts, and json payloads
function parseMarkdown(text: string): ReactNode[] {
  // Check if entire text is a JSON payload
  const wholeJson = tryParseJson(text);
  if (wholeJson) {
    return [
      <div
        key="json-block"
        className="relative group/code rounded-lg border border-border/70 bg-muted/30 dark:bg-muted/15 font-mono text-xs overflow-hidden shadow-2xs"
      >
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
          <span className="flex items-center gap-1.5 text-foreground/80">
            <Code2 className="h-3.5 w-3.5 text-primary" />
            JSON Payload
          </span>
          <CopyButton
            text={wholeJson}
            label="Copy JSON"
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          />
        </div>
        <div className="p-2.5 sm:p-3 leading-relaxed font-mono whitespace-pre max-h-56 overflow-y-auto overflow-x-auto text-xs text-foreground">
          {renderJsonLines(wholeJson)}
        </div>
      </div>,
    ];
  }

  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let inList = false;
  let listItems: ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLanguage = '';

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul
          key={`list-${elements.length}`}
          className="my-1.5 space-y-1 list-disc list-inside text-foreground/90 text-xs"
        >
          {listItems}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  const flushCodeBlock = (idx: number) => {
    if (inCodeBlock) {
      const codeContent = codeBlockLines.join('\n');
      const isJsonCode = codeLanguage.toLowerCase() === 'json';
      const parsedBlockJson = isJsonCode ? tryParseJson(codeContent) : null;

      elements.push(
        <div
          key={`codeblock-${idx}`}
          className="relative group/code my-2 rounded-lg border border-border/70 bg-muted/30 dark:bg-muted/15 font-mono text-xs overflow-hidden shadow-2xs"
        >
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-foreground/80">
              <Code2 className="h-3.5 w-3.5 text-primary" />
              {codeLanguage || 'Code Block'}
            </span>
            <CopyButton
              text={codeContent}
              label="Copy"
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            />
          </div>
          <div className="p-2.5 sm:p-3 leading-relaxed font-mono whitespace-pre max-h-56 overflow-y-auto overflow-x-auto text-xs text-foreground">
            {parsedBlockJson ? renderJsonLines(parsedBlockJson) : codeContent}
          </div>
        </div>
      );
      codeBlockLines = [];
      inCodeBlock = false;
      codeLanguage = '';
    }
  };

  const renderInline = (line: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const pattern = /(`[^`]+`)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))|(\*\*[^*]+\*\*)/g;
    let cursor = 0;

    for (const match of line.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > cursor) {
        parts.push(line.slice(cursor, index));
      }

      const matchedStr = match[0];
      if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
        parts.push(
          <code
            key={`${index}-code`}
            className="px-1.5 py-0.5 rounded bg-muted/70 dark:bg-muted/40 text-foreground font-mono text-[11px] font-medium border border-border/60"
          >
            {matchedStr.slice(1, -1)}
          </code>
        );
      } else if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
        parts.push(
          <strong key={`${index}-strong`} className="font-semibold text-foreground">
            {matchedStr.slice(2, -2)}
          </strong>
        );
      } else if (matchedStr.startsWith('[')) {
        const linkMatch = matchedStr.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        if (linkMatch) {
          parts.push(
            <a
              key={`${index}-link`}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium"
            >
              {linkMatch[1]}
            </a>
          );
        } else {
          parts.push(matchedStr);
        }
      }
      cursor = index + matchedStr.length;
    }

    if (cursor < line.length) {
      parts.push(line.slice(cursor));
    }
    return parts;
  };

  lines.forEach((rawLine, i) => {
    const trimmed = rawLine.trim();

    // Code fence toggle (```json, ```yaml, ```)
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock(i);
      } else {
        flushList();
        inCodeBlock = true;
        codeLanguage = trimmed.slice(3).trim();
      }
      return;
    }

    // Inside code block
    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      return;
    }

    // Markdown Headers (###, ##, #)
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h4
          key={`h4-${i}`}
          className="mt-3 mb-1.5 text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
          {renderInline(trimmed.slice(4))}
        </h4>
      );
    } else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h3
          key={`h3-${i}`}
          className="mt-3.5 mb-1.5 text-sm font-bold text-foreground border-b pb-1 border-border/60"
        >
          {renderInline(trimmed.slice(3))}
        </h3>
      );
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="mt-4 mb-2 text-base font-bold text-foreground">
          {renderInline(trimmed.slice(2))}
        </h2>
      );
    }
    // Bullet list items (- or *)
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(
        <li key={`li-${i}`} className="leading-relaxed">
          {renderInline(trimmed.slice(2))}
        </li>
      );
    }
    // Key: Value monitoring metric pattern (e.g., "Host: i-019284", "Threshold: > 95%", "Metric: cpu_usage")
    else if (
      /^[A-Za-z0-9_-]+:\s+.+$/.test(trimmed) &&
      !trimmed.startsWith('http://') &&
      !trimmed.startsWith('https://')
    ) {
      flushList();
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx);
      const val = trimmed.slice(colonIdx + 1).trim();
      elements.push(
        <div key={`kv-${i}`} className="my-0.5 flex items-baseline gap-2 font-mono text-xs">
          <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[11px] shrink-0">
            {key}:
          </span>
          <span className="text-foreground font-medium break-all">{val}</span>
        </div>
      );
    }
    // Empty line / paragraph separator
    else if (trimmed === '') {
      flushList();
      elements.push(<div key={`spacer-${i}`} className="h-1.5" />);
    }
    // Standard paragraph line
    else {
      flushList();
      elements.push(
        <p key={`p-${i}`} className="my-1 leading-relaxed text-foreground/90 text-xs">
          {renderInline(rawLine)}
        </p>
      );
    }
  });

  if (inCodeBlock) {
    flushCodeBlock(lines.length);
  }
  flushList();
  return elements;
}

const FORMAT_LABEL: Record<ReadablePayload['format'], string> = {
  json: 'JSON',
  literal: 'Literal',
  xml: 'XML',
  logfmt: 'logfmt',
  form: 'Form data',
  kv: 'Key/value',
  markdown: 'Markdown',
  text: 'Text',
};

export function IncidentDescriptionCard({
  incidentId: _incidentId,
  description,
  canManage,
  onUpdateDescription,
  className,
  context,
  readable = null,
  clamp = false,
}: IncidentDescriptionCardProps) {
  // The remembered choice lives in localStorage (an external store); the server render is the summary.
  const full = useSyncExternalStore(subscribeFull, readFull, () => false);
  const [tall, setTall] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = contentRef.current;
    if (!clamp || !element) return;
    const measure = () => setTall(element.scrollHeight > CLAMP_PX + 48);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [clamp]);
  const toggleFull = () => writeFull(!full);
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(description || '');
  const [isPending, startTransition] = useTransition();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const rawDescription = description?.trim() || '';
  const wholeJson = useMemo(() => tryParseJson(rawDescription), [rawDescription]);
  const structured = Boolean(readable && !['text', 'markdown'].includes(readable.format));
  const collapsible = Boolean(wholeJson) || structured;
  const isLong =
    !wholeJson && (rawDescription.split('\n').length > 18 || rawDescription.length > 1200);

  const parsedContent = useMemo(() => {
    if (!rawDescription) return null;
    return parseMarkdown(rawDescription);
  }, [rawDescription]);

  const handleSave = () => {
    startTransition(async () => {
      if (onUpdateDescription) {
        await onUpdateDescription(editedText);
      }
      setIsEditing(false);
      router.refresh();
    });
  };

  const handleCancel = () => {
    setEditedText(description || '');
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden text-card-foreground transition-all flex flex-col',
        className
      )}
    >
      {/* Header bar */}
      <div className="px-3.5 py-1.5 border-b border-border/70 bg-muted/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <h3 className="text-xs font-semibold text-foreground">Description &amp; Context</h3>
          {rawDescription && (
            <span className="text-[10px] font-medium text-muted-foreground">
              ({rawDescription.split(/\s+/).filter(Boolean).length} words)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {rawDescription && !isEditing && (
            <CopyButton
              text={rawDescription}
              label="Copy Description"
              className="h-6 px-2 text-xs font-medium"
            />
          )}
          {canManage && !isEditing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditedText(description || '');
                setIsEditing(true);
              }}
              className="h-6 px-2 gap-1 text-[11px] font-medium"
            >
              <Edit2 className="h-3 w-3" />
              <span>Edit</span>
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(clamp && tall && !full && !isEditing && 'overflow-hidden')}
        style={clamp && tall && !full && !isEditing ? { maxHeight: CLAMP_PX } : undefined}
      >
        <div ref={contentRef}>
          {/* Verified context first, the raw description/payload below it as the evidence. */}
          {context && <div className="border-b border-border/70 px-3.5 py-2.5">{context}</div>}

          {/* Body */}
          <div className="p-2.5 sm:p-3">
            {isEditing ? (
              <div className="space-y-2.5">
                <Textarea
                  value={editedText}
                  onChange={e => setEditedText(e.target.value)}
                  placeholder="Add incident diagnostic notes, customer impact, or context... (Markdown, JSON, logs supported)"
                  rows={8}
                  className="w-full text-xs font-mono leading-relaxed resize-y border-border focus-visible:ring-1 focus-visible:ring-primary bg-background text-foreground"
                  disabled={isPending}
                />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-muted-foreground">
                    Tip: Markdown, JSON payloads, code blocks (<code>```</code>), and key: value
                    pairs are supported.
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCancel}
                      disabled={isPending}
                      className="h-7 gap-1 text-xs"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Cancel</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSave}
                      disabled={isPending}
                      className="h-7 gap-1.5 text-xs font-semibold"
                    >
                      {isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      <span>Save Changes</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : collapsible && !showPayload ? (
              // A structured payload: its readable view first (no AI), the raw source one row below.
              <div className="space-y-3">
                {structured && readable && <ReadablePayloadView view={readable} />}
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <Code2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    Raw alert payload
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {FORMAT_LABEL[readable?.format ?? 'json']} ·{' '}
                    {(wholeJson ?? rawDescription).split('\n').length} lines
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <CopyButton
                      text={wholeJson ?? rawDescription}
                      label="Copy raw payload"
                      className="h-7 px-2 text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPayload(true)}
                      className="h-7 gap-1 px-2.5 text-xs font-medium"
                      aria-expanded={false}
                    >
                      {structured ? 'View raw' : 'View'}
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </span>
                </div>
              </div>
            ) : rawDescription ? (
              <div>
                {collapsible && (
                  <div className="mb-1.5 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPayload(false)}
                      className="h-6 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      aria-expanded
                    >
                      Hide payload
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
                <div
                  className={cn(
                    'text-xs text-foreground transition-all',
                    isLong && !isExpanded && 'max-h-[220px] overflow-hidden'
                  )}
                >
                  {parsedContent}
                </div>

                {/* Clean expand/collapse toggle without greyish gradient flare */}
                {isLong && !isExpanded && (
                  <div className="mt-2 pt-2 border-t border-border/60 flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsExpanded(true)}
                      className="h-6 px-2.5 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span>Show full description</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                {isLong && isExpanded && (
                  <div className="mt-2 pt-2 border-t border-border/60 flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsExpanded(false)}
                      className="h-6 px-2.5 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span>Collapse description</span>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-xs text-muted-foreground italic">
                No incident description provided.{' '}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="text-primary hover:underline font-semibold not-italic ml-1"
                  >
                    Add description
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {clamp && tall && !isEditing && (
        <div className="flex justify-center border-t border-border/60 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleFull}
            aria-expanded={full}
            className="h-7 gap-1 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {full ? 'Show less' : 'Show full alert'}
            {full ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

export default IncidentDescriptionCard;
