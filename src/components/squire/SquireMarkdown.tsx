'use client';

import { useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import Link from 'next/link';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

type Node = { type: string; value?: string; url?: string; children?: Node[] };
/** Link bare OpsKnight paths only when the server supplied that exact citation. Never touch code. */
function literalHtml() {
  return (tree: Node) => {
    function walk(node: Node) {
      if (node.type === 'html') node.type = 'text';
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}
function citationLinks(allowed: Map<string, string>) {
  return () => (tree: Node) => {
    function walk(node: Node) {
      if (!node.children || ['link', 'code', 'inlineCode', 'html'].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) {
          walk(child);
          return [child];
        }
        return child.value
          .split(
            /(\/(?:incidents|runbooks|changes|alerts|services|schedules|postmortems)\/[A-Za-z0-9_-]{1,64})/g
          )
          .filter(Boolean)
          .map(value =>
            allowed.has(value)
              ? {
                  type: 'link',
                  url: value,
                  children: [{ type: 'text', value: allowed.get(value) ?? value }],
                }
              : { type: 'text', value }
          );
      });
    }
    walk(tree);
  };
}

function codeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(codeText).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return codeText((node.props as { children?: ReactNode }).children);
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [notice, setNotice] = useState('');
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-muted/50">
      <div className="flex items-center justify-between border-b border-border px-3">
        <span className="text-xs text-muted-foreground">Code</span>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codeText(children).replace(/\n$/, ''));
              setNotice('Code copied');
            } catch {
              setNotice('Could not copy. Select the code to copy it.');
            }
          }}
        >
          <Copy aria-hidden="true" />
          Copy code
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-6">{children}</pre>
      {notice && (
        <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}

export default function SquireMarkdown({
  text,
  allowed,
  references = [],
}: {
  text: string;
  allowed: string[];
  references?: Array<{ href: string; label: string }>;
}) {
  const citations = new Map(
    allowed.map(href => [
      href,
      references.some(item => item.href === href)
        ? href.startsWith('/incidents/')
          ? 'View incident'
          : href.startsWith('/runbooks/')
            ? 'Open runbook'
            : href.startsWith('/changes/')
              ? 'View change'
              : href.startsWith('/services/')
                ? 'View service'
                : href.startsWith('/schedules/')
                  ? 'View schedule'
                  : href.startsWith('/postmortems/')
                    ? 'View postmortem'
                    : 'View alert'
        : href,
    ])
  );
  return (
    <div className="squire-markdown min-w-0 break-words text-sm leading-7 [&_p]:my-2 [&_p]:whitespace-pre-line [&_strong]:font-semibold [&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:font-mono [&_p_code]:rounded [&_p_code]:bg-muted [&_p_code]:px-1 [&_p_code]:py-0.5 [&_p_code]:text-xs">
      <Markdown
        remarkPlugins={[remarkGfm, literalHtml, citationLinks(citations)]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={url => (citations.has(url) ? url : undefined)}
        components={{
          a: ({ href, children }) =>
            href && citations.has(href) ? (
              <Link href={href} className="font-medium text-primary underline underline-offset-4">
                {children}
              </Link>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span>{alt ? `[${alt}]` : ''}</span>,
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2">
                {children}
              </table>
            </div>
          ),
          input: () => null,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
