'use client';

import type { ReactNode } from 'react';
import { Code2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { ClaudeLogo, CursorLogo, ChatGptLogo } from '@/components/common/BrandLogos';
import McpCopyField from '@/components/settings/mcp/McpCopyField';
import { mcpSetupCommands } from '@/components/settings/mcp/setup-commands';

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
] as const;

/** Per-assistant setup steps with the endpoint already filled in. */
export default function McpConnectGuide({ endpoint }: { endpoint: string }) {
  const commands = mcpSetupCommands(endpoint);
  const endpointField = <McpCopyField value={endpoint} label="MCP server URL" />;
  return (
    <Tabs defaultValue="claude-code" className="space-y-5">
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
            <McpCopyField value={commands.claudeCode} label="Claude Code setup command" multiline />
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
              In Claude, open <span className="font-medium">Settings → Connectors</span> and choose{' '}
              <span className="font-medium">Add custom connector</span>.
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
              In ChatGPT, open <span className="font-medium">Settings → Connectors</span> and create
              a custom connector.
            </p>
          </Step>
          <Step>
            <p>Paste this URL and choose OAuth for authentication:</p>
            {endpointField}
          </Step>
          <Step>
            <p>Sign in to OpsKnight when prompted and approve the request.</p>
          </Step>
        </Steps>
        <p className="mt-4 text-xs text-muted-foreground">
          Custom connectors depend on your ChatGPT plan, and some workspaces require an
          administrator to allow them.
        </p>
      </TabsContent>

      <TabsContent value="cursor" className="mt-0">
        <Steps>
          <Step>
            <p>
              Add this to{' '}
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
            <p>Run this in your terminal:</p>
            <McpCopyField value={commands.vscode} label="VS Code setup command" multiline />
          </Step>
          <Step>
            <p>
              Or open the Command Palette, run <span className="font-medium">MCP: Add Server</span>,
              choose HTTP and paste:
            </p>
            {endpointField}
          </Step>
          <Step>
            <p>Start the server from the MCP view and sign in when VS Code asks.</p>
          </Step>
        </Steps>
      </TabsContent>
    </Tabs>
  );
}
