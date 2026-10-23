'use client';

import React, { useState, type ReactNode } from 'react';
import { ExternalLink, Paperclip, Copy, Check, FileText, ZoomIn, X } from 'lucide-react';

function getSafeUrl(urlStr: string): string | null {
  const trimmed = urlStr.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('data:image/') || trimmed.startsWith('./')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];

function isImageExtension(url: string): boolean {
  if (url.startsWith('data:image/')) return true;
  const clean = url.split('?')[0].toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => clean.endsWith(ext));
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative group/code my-2 rounded-lg border border-border/70 bg-muted/40 font-mono text-xs overflow-hidden shadow-2xs">
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/50 bg-muted/60 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
        <span>{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              <span className="text-emerald-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-2.5 text-xs font-mono text-foreground overflow-x-auto whitespace-pre leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

function NoteImage({ src, alt }: { src: string; alt: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  if (loadError) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 my-1 rounded-lg border border-border/70 bg-muted/20 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span>Image unavailable: {alt || src}</span>
      </div>
    );
  }

  return (
    <>
      <div className="my-2 max-w-md group/img relative overflow-hidden rounded-xl border border-border/70 bg-muted/20 shadow-2xs transition-all hover:border-primary/40 hover:shadow-xs">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || 'Image attachment'}
          onError={() => setLoadError(true)}
          className="max-h-64 w-auto object-contain rounded-t-xl cursor-zoom-in bg-background/50"
          onClick={() => setIsOpen(true)}
          loading="lazy"
        />
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] bg-card/90 border-t border-border/50 text-muted-foreground">
          <span className="truncate max-w-[220px] font-medium text-foreground/80">
            {alt || 'Image attachment'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="text-[10px] text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
            >
              <ZoomIn className="h-3 w-3" />
              Zoom
            </button>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs animate-in fade-in-50 duration-150"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-card rounded-2xl border border-border/80 p-2 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
              <span className="text-xs font-semibold text-foreground truncate max-w-md">
                {alt || 'Image preview'}
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-2 flex items-center justify-center max-h-[75vh] overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt || 'Full image preview'}
                className="max-h-[72vh] w-auto object-contain rounded-lg shadow-xs"
              />
            </div>
            <div className="px-3 py-1.5 border-t border-border/60 flex justify-end">
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
              >
                Open in new tab <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function renderInlineMarkdown(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Matches:
  // 1: Images ![alt](url)
  // 4: Links [text](url)
  // 7: Inline code `code`
  // 9: Bold **bold**
  // 11: Bold __bold__
  // 13: Italic *italic*
  // 15: Italic _italic_
  // 17: Strike ~~strike~~
  // 19: Raw URL
  const INLINE_REGEX =
    /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(~~([^~]+)~~)|(https?:\/\/[^\s<)]+)/g;

  let cursor = 0;

  for (const match of line.matchAll(INLINE_REGEX)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(line.slice(cursor, index));
    }

    const fullMatch = match[0];

    // 1. Image ![alt](url)
    if (match[1]) {
      const alt = match[2];
      const url = match[3];
      const safe = getSafeUrl(url);
      if (safe) {
        parts.push(<NoteImage key={`img-${index}-${safe}`} src={safe} alt={alt} />);
      } else {
        parts.push(fullMatch);
      }
    }
    // 2. Link [text](url)
    else if (match[4]) {
      const label = match[5];
      const url = match[6];
      const safe = getSafeUrl(url);
      if (safe) {
        // If it's a file attachment or image URL
        const isImage = isImageExtension(safe);
        const isAttachment =
          label.startsWith('📎') || /\.(pdf|zip|tar|gz|csv|json|txt|log|docx?|xlsx?)$/i.test(safe);

        if (
          isImage &&
          (label.toLowerCase() === 'image' ||
            label.toLowerCase().endsWith('.png') ||
            label.toLowerCase().endsWith('.jpg'))
        ) {
          parts.push(<NoteImage key={`link-img-${index}-${safe}`} src={safe} alt={label} />);
        } else if (isAttachment) {
          parts.push(
            <a
              key={`att-${index}-${safe}`}
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 my-0.5 px-2.5 py-1 rounded-lg bg-muted/60 border border-border/80 text-foreground text-xs font-medium hover:bg-muted transition-colors shadow-2xs group/att"
            >
              <Paperclip className="h-3 w-3 text-primary shrink-0" />
              <span className="truncate max-w-[200px]">{label}</span>
              <ExternalLink className="h-2.5 w-2.5 text-muted-foreground group-hover/att:text-foreground" />
            </a>
          );
        } else {
          parts.push(
            <a
              key={`link-${index}-${safe}`}
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:text-primary/80 transition-colors font-medium break-all"
            >
              {label}
            </a>
          );
        }
      } else {
        parts.push(fullMatch);
      }
    }
    // 3. Inline code `code`
    else if (match[7]) {
      parts.push(
        <code
          key={`code-${index}`}
          className="px-1.5 py-0.5 rounded bg-muted/80 text-foreground font-mono text-[11px] font-medium border border-border/60"
        >
          {match[8]}
        </code>
      );
    }
    // 4. Bold **bold** or __bold__
    else if (match[9] || match[11]) {
      const boldText = match[10] || match[12];
      parts.push(
        <strong key={`bold-${index}`} className="font-bold text-foreground">
          {boldText}
        </strong>
      );
    }
    // 5. Italic *italic* or _italic_
    else if (match[13] || match[15]) {
      const italicText = match[14] || match[16];
      parts.push(
        <em key={`italic-${index}`} className="italic text-foreground">
          {italicText}
        </em>
      );
    }
    // 6. Strikethrough ~~strike~~
    else if (match[17]) {
      parts.push(
        <del key={`del-${index}`} className="line-through text-muted-foreground">
          {match[18]}
        </del>
      );
    }
    // 7. Raw URL autolink
    else if (match[19]) {
      const url = match[19];
      const safe = getSafeUrl(url);
      if (safe) {
        if (isImageExtension(safe)) {
          parts.push(<NoteImage key={`autourl-img-${index}`} src={safe} alt={safe} />);
        } else {
          parts.push(
            <a
              key={`autourl-${index}`}
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:text-primary/80 transition-colors font-medium break-all"
            >
              {url}
            </a>
          );
        }
      } else {
        parts.push(url);
      }
    }

    cursor = index + fullMatch.length;
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts;
}

export function NoteMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLanguage = '';

  let inList = false;
  let listItems: ReactNode[] = [];

  const flushList = (key: string) => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-${key}`} className="my-1.5 space-y-1 list-disc list-inside text-xs">
          {listItems}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  const flushCode = (key: string) => {
    if (inCodeBlock) {
      elements.push(
        <CodeBlock key={`code-${key}`} code={codeBlockLines.join('\n')} language={codeLanguage} />
      );
      codeBlockLines = [];
      inCodeBlock = false;
      codeLanguage = '';
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    // Code fence toggle
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        flushCode(`fence-${i}`);
      } else {
        flushList(`before-fence-${i}`);
        inCodeBlock = true;
        codeLanguage = trimmed.slice(3).trim();
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    // List item (- item or * item)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(
        <li key={`li-${i}`} className="leading-relaxed">
          {renderInlineMarkdown(trimmed.slice(2))}
        </li>
      );
      return;
    }

    // Numbered list item (1. item)
    if (/^\d+\.\s/.test(trimmed)) {
      inList = true;
      const contentPart = trimmed.replace(/^\d+\.\s/, '');
      listItems.push(
        <li key={`li-num-${i}`} className="leading-relaxed list-decimal">
          {renderInlineMarkdown(contentPart)}
        </li>
      );
      return;
    }

    // Normal line: flush list if active
    flushList(`flush-${i}`);

    // Blockquote
    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-2 border-primary/40 pl-3 my-1.5 italic text-muted-foreground text-xs"
        >
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
      return;
    }

    // Empty line: paragraph separator
    if (trimmed === '') {
      elements.push(<div key={`blank-${i}`} className="h-1.5" />);
      return;
    }

    // Standard paragraph line
    elements.push(
      <div key={`p-${i}`} className="leading-relaxed">
        {renderInlineMarkdown(line)}
      </div>
    );
  });

  flushCode('end');
  flushList('end');

  return <div className="space-y-0.5 text-xs text-foreground break-words">{elements}</div>;
}
