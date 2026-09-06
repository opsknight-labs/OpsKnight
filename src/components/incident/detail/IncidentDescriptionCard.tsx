'use client';

import { useState, useTransition, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import CopyButton from '@/components/common/CopyButton';
import { updateIncidentDescription } from '@/app/(app)/incidents/actions';
import { FileText, Edit2, Check, X, Loader2, ChevronDown, ChevronUp, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type IncidentDescriptionCardProps = {
  incidentId: string;
  description: string | null;
  canManage: boolean;
  className?: string;
};

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

// Universal parser for markdown, code fences, key-value alerts, and json payloads
function parseMarkdown(text: string): ReactNode[] {
  // Check if entire text is a JSON payload
  const wholeJson = tryParseJson(text);
  if (wholeJson) {
    return [
      <div
        key="json-block"
        className="relative group/code my-2 rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs overflow-x-auto shadow-inner"
      >
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80 text-slate-400">
          <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
            <Code2 className="h-3.5 w-3.5 text-blue-400" />
            JSON Payload
          </span>
          <CopyButton
            text={wholeJson}
            label="Copy JSON"
            className="h-6 px-2 text-[11px] text-slate-400 hover:text-white"
          />
        </div>
        <pre className="text-emerald-400 leading-relaxed font-mono whitespace-pre">{wholeJson}</pre>
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
          className="my-2 space-y-1 list-disc list-inside text-slate-700 dark:text-slate-300"
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
      elements.push(
        <div
          key={`codeblock-${idx}`}
          className="relative group/code my-3 rounded-lg border border-slate-800 bg-slate-950 p-3.5 font-mono text-xs overflow-x-auto shadow-inner"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Code2 className="h-3.5 w-3.5 text-blue-400" />
              {codeLanguage || 'Code Block'}
            </span>
            <CopyButton
              text={codeContent}
              label="Copy"
              className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
            />
          </div>
          <pre className="text-emerald-400 leading-relaxed font-mono whitespace-pre m-0">
            {codeContent}
          </pre>
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
            className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-xs font-semibold"
          >
            {matchedStr.slice(1, -1)}
          </code>
        );
      } else if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
        parts.push(
          <strong
            key={`${index}-strong`}
            className="font-semibold text-slate-900 dark:text-slate-100"
          >
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
              className="text-primary hover:underline font-semibold"
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
          className="mt-4 mb-2 text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-1.5"
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
          className="mt-5 mb-2 text-base font-bold text-slate-900 dark:text-slate-100 border-b pb-1 border-slate-100 dark:border-slate-800"
        >
          {renderInline(trimmed.slice(3))}
        </h3>
      );
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h2
          key={`h2-${i}`}
          className="mt-6 mb-2 text-lg font-bold text-slate-900 dark:text-slate-100"
        >
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
        <div key={`kv-${i}`} className="my-1 flex items-baseline gap-2 font-mono text-xs">
          <span className="text-slate-500 font-semibold uppercase tracking-wider shrink-0">
            {key}:
          </span>
          <span className="text-slate-800 dark:text-slate-200 font-medium break-all">{val}</span>
        </div>
      );
    }
    // Empty line / paragraph separator
    else if (trimmed === '') {
      flushList();
      elements.push(<div key={`spacer-${i}`} className="h-2" />);
    }
    // Standard paragraph line
    else {
      flushList();
      elements.push(
        <p key={`p-${i}`} className="my-1.5 leading-relaxed text-slate-700 dark:text-slate-300">
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

export default function IncidentDescriptionCard({
  incidentId,
  description,
  canManage,
  className,
}: IncidentDescriptionCardProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(description || '');
  const [isPending, startTransition] = useTransition();
  const [isExpanded, setIsExpanded] = useState(false);

  const rawDescription = description?.trim() || '';
  const isLong = rawDescription.split('\n').length > 12 || rawDescription.length > 800;

  const parsedContent = useMemo(() => {
    if (!rawDescription) return null;
    return parseMarkdown(rawDescription);
  }, [rawDescription]);

  const handleSave = () => {
    startTransition(async () => {
      await updateIncidentDescription(incidentId, editedText);
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
        'rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:bg-slate-900 dark:border-slate-800 transition-all flex flex-col',
        className
      )}
    >
      {/* Header bar */}
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500 shrink-0" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Description &amp; Context
          </h3>
          {rawDescription && (
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
              ({rawDescription.split(/\s+/).filter(Boolean).length} words)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {rawDescription && !isEditing && (
            <CopyButton
              text={rawDescription}
              label="Copy Description"
              className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 h-7 px-2 text-xs font-medium"
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
              className="h-7 px-2.5 gap-1.5 text-xs font-medium border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300"
            >
              <Edit2 className="h-3 w-3" />
              <span>Edit</span>
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-5 md:p-6">
        {isEditing ? (
          <div className="space-y-3">
            <Textarea
              value={editedText}
              onChange={e => setEditedText(e.target.value)}
              placeholder="Add incident diagnostic notes, customer impact, or context... (Markdown, JSON, logs supported)"
              rows={8}
              className="w-full text-sm font-mono leading-relaxed resize-y border-slate-300 focus-visible:ring-1 focus-visible:ring-primary"
              disabled={isPending}
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-400">
                Tip: Markdown, JSON payloads, code blocks (<code>```</code>), and key: value pairs
                are supported.
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={isPending}
                  className="h-8 gap-1 text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={isPending}
                  className="h-8 gap-1.5 text-xs font-semibold"
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
        ) : rawDescription ? (
          <div className="relative">
            <div
              className={cn(
                'text-sm text-slate-800 dark:text-slate-200 transition-all',
                isLong && !isExpanded && 'max-h-[300px] overflow-hidden'
              )}
            >
              {parsedContent}
            </div>

            {/* Gradient fade and expand button if content is long */}
            {isLong && !isExpanded && (
              <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-slate-900 dark:via-slate-900/80 pointer-events-none flex items-end justify-center pb-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsExpanded(true)}
                  className="pointer-events-auto h-7 px-3 gap-1.5 text-xs font-semibold bg-white/95 dark:bg-slate-800/95 shadow-xs border-slate-200 dark:border-slate-700"
                >
                  <span>Show full description</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {isLong && isExpanded && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(false)}
                  className="h-7 px-3 gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  <span>Collapse description</span>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-slate-400 dark:text-slate-500 italic">
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
  );
}
