'use client';

import { useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, Code2, ExternalLink, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { ClaudeLogo, CursorLogo, ChatGptLogo } from '@/components/common/BrandLogos';
import McpCopyField from '@/components/settings/mcp/McpCopyField';
import McpDocsLinks from '@/components/settings/mcp/McpDocsLinks';
import { mcpSetupCommands } from '@/components/settings/mcp/setup-commands';
import { MCP_DOCS_LINKS } from '@/lib/mcp/docs-links';

/** What "Check connection" learns: the viewer's newest live connection, if one is recent. */
type ConnectionCheck =
  { connected: false } | { connected: true; client: string; createdAt: string };

/** Opens the assistant's own install prompt; the person still confirms there. */
function InstallLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
      <a href={href}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </a>
    </Button>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-none space-y-3 p-0 text-sm [counter-reset:step]">{children}</ol>;
}

function Step({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-8 pr-0 py-0 [counter-increment:step] before:absolute before:left-0 before:top-0 before:flex before:h-5 before:w-5 before:items-center before:justify-center before:rounded-full before:bg-primary/10 before:text-[11px] before:font-semibold before:text-primary before:content-[counter(step)]">
      <div className="space-y-2 leading-relaxed">{children}</div>
    </li>
  );
}

const ASSISTANTS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    icon: <ClaudeLogo className="h-3.5 w-3.5 shrink-0" />,
  },
  { id: 'claude', label: 'Claude', icon: <ClaudeLogo className="h-3.5 w-3.5 shrink-0" /> },
  { id: 'chatgpt', label: 'ChatGPT', icon: <ChatGptLogo className="h-3.5 w-3.5 shrink-0" /> },
  { id: 'cursor', label: 'Cursor', icon: <CursorLogo className="h-3.5 w-3.5 shrink-0" /> },
  { id: 'vscode', label: 'VS Code', icon: <Code2 className="h-3.5 w-3.5 shrink-0 text-sky-500" /> },
  {
    id: 'other',
    label: 'Other clients',
    icon: <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />,
  },
] as const;

type AssistantId = (typeof ASSISTANTS)[number]['id'];
const ASSISTANT_IDS: ReadonlySet<string> = new Set(ASSISTANTS.map(assistant => assistant.id));
/** The last tab chosen, so returning people land on their own assistant. */
const TAB_STORAGE_KEY = 'opsknight.mcp.connect-tab';

function readStoredTab(): AssistantId | null {
  try {
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
    return saved && ASSISTANT_IDS.has(saved) ? (saved as AssistantId) : null;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the default tab is fine.
    return null;
  }
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 1 ? 'just now' : `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

/** A success signal after signing in: no polling, the person asks when they are done. */
function CheckConnection({
  check,
  hrefs,
}: {
  check: () => Promise<ConnectionCheck>;
  hrefs: { connections: string; overview: string };
}) {
  const [result, setResult] = useState<ConnectionCheck | 'error' | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                setResult(await check());
              } catch {
                setResult('error');
              }
            })
          }
        >
          {pending ? 'Checking…' : 'Check connection'}
        </Button>
        <span className="text-xs text-muted-foreground">
          After you approve the request, check that the assistant is connected.
        </span>
      </div>
      <div aria-live="polite">
        {result && result !== 'error' && result.connected && (
          <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>
              Connected: {result.client}, {relativeTime(result.createdAt)} ·{' '}
              <Link href={hrefs.connections} className="font-medium underline underline-offset-2">
                View connection
              </Link>
            </span>
          </p>
        )}
        {result && result !== 'error' && !result.connected && (
          <p className="text-muted-foreground">
            Not connected yet. Finish signing in, or run the{' '}
            <Link href={hrefs.overview} className="font-medium underline underline-offset-2">
              setup check
            </Link>
            .
          </p>
        )}
        {result === 'error' && (
          <p className="text-muted-foreground">Could not check right now. Try again.</p>
        )}
      </div>
    </div>
  );
}

/** Per-assistant setup steps with the endpoint already filled in. */
export default function McpConnectGuide({
  endpoint,
  version,
  checkConnection,
  hrefs,
}: {
  endpoint: string;
  /** The running release, so the doctor download matches this server. */
  version: string;
  checkConnection?: () => Promise<ConnectionCheck>;
  hrefs?: { connections: string; overview: string };
}) {
  const commands = useMemo(() => mcpSetupCommands(endpoint, version), [endpoint, version]);
  // The default stays Claude Code on the server and during hydration (the server snapshot is
  // null), so markup is stable; the remembered tab applies on the client.
  const stored = useSyncExternalStore(subscribeToStorage, readStoredTab, () => null);
  const [chosen, setChosen] = useState<AssistantId | null>(null);
  const tab: AssistantId = chosen ?? stored ?? 'claude-code';
  const choose = (value: string) => {
    if (!ASSISTANT_IDS.has(value)) return;
    setChosen(value as AssistantId);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, value);
    } catch {
      // Not remembering the tab is harmless.
    }
  };
  const endpointField = useMemo(
    () => <McpCopyField value={endpoint} label="MCP server URL" />,
    [endpoint]
  );
  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={choose} className="space-y-5">
        <div className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-none">
          <TabsList
            aria-label="Assistant"
            className="h-auto min-w-max gap-1 rounded-lg border border-border/80 bg-muted/50 p-1"
          >
            {ASSISTANTS.map(assistant => (
              <TabsTrigger
                key={assistant.id}
                value={assistant.id}
                className="h-8 gap-1.5 rounded-md px-3 text-xs data-[state=active]:font-semibold data-[state=active]:ring-1 data-[state=active]:ring-border"
              >
                {assistant.icon}
                <span>{assistant.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="claude-code" className="mt-0">
          <Steps>
            <Step>
              <p>Run this in your terminal:</p>
              <McpCopyField
                value={commands.claudeCode}
                label="Claude Code setup command"
                multiline
              />
            </Step>
            <Step>
              <p>
                Start Claude Code, run{' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">/mcp</code>, choose{' '}
                <span className="font-medium">opsknight</span> and sign in with your OpsKnight
                account.
              </p>
            </Step>
            <Step>
              <p>Approve the access request in OpsKnight. Your own permissions apply.</p>
            </Step>
          </Steps>
        </TabsContent>

        <TabsContent value="claude" className="mt-0">
          <Steps>
            <Step>
              <p>
                In Claude, open <span className="font-medium">Settings → Connectors</span> and
                choose <span className="font-medium">Add custom connector</span>.
              </p>
            </Step>
            <Step>
              <p>Name it OpsKnight and paste this URL:</p>
              {endpointField}
            </Step>
            <Step>
              <p>Select Connect, sign in to OpsKnight and approve the request.</p>
            </Step>
          </Steps>
          <p className="mt-4 text-xs text-muted-foreground">
            Menu names vary by app version. On Team and Enterprise plans an owner may need to allow
            custom connectors first.
          </p>
        </TabsContent>

        <TabsContent value="chatgpt" className="mt-0">
          <Steps>
            <Step>
              <p>
                Open ChatGPT Plugins (<span className="font-medium">chatgpt.com/plugins</span>),
                select <span className="font-medium">+</span>, then{' '}
                <span className="font-medium">Add custom MCP server</span>, and name it OpsKnight.
              </p>
            </Step>
            <Step>
              <p>
                Under Connection, paste this URL for a public server, or choose Tunnel for a private
                installation. Choose OAuth for authentication; ChatGPT registers itself
                automatically.
              </p>
              {endpointField}
            </Step>
            <Step>
              <p>
                Accept the warning, select <span className="font-medium">Create</span> as a plugin,
                then sign in to OpsKnight and approve the request.
              </p>
            </Step>
          </Steps>
          <p className="mt-4 text-xs text-muted-foreground">
            Menu names vary by app version. Developer mode or a workspace administrator&apos;s
            permission may be required, and some plans allow only read and fetch tools. See{' '}
            <a
              href="https://developers.openai.com/api/docs/guides/custom-mcp-server"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              OpenAI&apos;s guide
            </a>{' '}
            for current steps and Secure MCP Tunnel.
          </p>
        </TabsContent>

        <TabsContent value="cursor" className="mt-0">
          <Steps>
            <Step>
              <p>Install with one click (Cursor asks you to confirm):</p>
              <InstallLink href={commands.cursorInstall} label="Add to Cursor" />
            </Step>
            <Step>
              <p>
                Or add this to{' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">~/.cursor/mcp.json</code>{' '}
                (or the project&apos;s{' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">.cursor/mcp.json</code>):
              </p>
              <McpCopyField value={commands.cursor} label="Cursor configuration" multiline />
            </Step>
            <Step>
              <p>Open Cursor&apos;s MCP settings, select OpsKnight and sign in when prompted.</p>
            </Step>
          </Steps>
        </TabsContent>

        <TabsContent value="vscode" className="mt-0">
          <Steps>
            <Step>
              <p>Install with one click (VS Code asks you to confirm):</p>
              <InstallLink href={commands.vscodeInstall} label="Add to VS Code" />
            </Step>
            <Step>
              <p>Or run this in your terminal:</p>
              <McpCopyField value={commands.vscode} label="VS Code setup command" multiline />
              <p className="text-xs text-muted-foreground">
                For macOS and Linux shells. On Windows, use the one-click link or the Command
                Palette route below; PowerShell and cmd quote the JSON differently.
              </p>
            </Step>
            <Step>
              <p>
                Or open the Command Palette, run{' '}
                <span className="font-medium">MCP: Add Server</span>, choose HTTP and paste:
              </p>
              {endpointField}
            </Step>
            <Step>
              <p>Start the server from the MCP view and sign in when VS Code asks.</p>
            </Step>
          </Steps>
        </TabsContent>
        <TabsContent value="other" className="mt-0">
          <Steps>
            <Step>
              <p>Any assistant that supports remote MCP servers with OAuth uses this URL:</p>
              {endpointField}
            </Step>
            <Step>
              <p>Codex CLI: add the server, then sign in.</p>
              <McpCopyField value={commands.codex} label="Codex setup command" multiline />
              <McpCopyField value={commands.codexLogin} label="Codex sign-in command" />
            </Step>
            <Step>
              <p>
                Gemini CLI: add the server, then run{' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">/mcp auth opsknight</code>{' '}
                in Gemini CLI. Or put this in{' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">
                  ~/.gemini/settings.json
                </code>
                :
              </p>
              <McpCopyField value={commands.geminiCli} label="Gemini CLI setup command" multiline />
              <McpCopyField
                value={commands.geminiSettings}
                label="Gemini CLI configuration"
                multiline
              />
            </Step>
            <Step>
              <p>
                Windsurf: add this to{' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">
                  ~/.codeium/windsurf/mcp_config.json
                </code>{' '}
                and sign in when prompted.
              </p>
              <McpCopyField value={commands.windsurf} label="Windsurf configuration" multiline />
            </Step>
          </Steps>
          <p className="mt-4 text-xs text-muted-foreground">
            These clients are expected to work but have not been verified end to end. See the{' '}
            <a
              href={`${MCP_DOCS_LINKS.guide}#client-compatibility`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              compatibility table
            </a>
            .
          </p>
        </TabsContent>
      </Tabs>
      {checkConnection && hrefs && <CheckConnection check={checkConnection} hrefs={hrefs} />}
      <McpDocsLinks />
    </div>
  );
}
