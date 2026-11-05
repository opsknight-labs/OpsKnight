import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import McpPolicyForm, { type McpPolicyAction } from '@/components/settings/mcp/McpPolicyForm';
import McpPolicyScopeSelector from '@/components/settings/mcp/McpPolicyScopeSelector';
import SessionIdleSelect from '@/components/settings/mcp/SessionIdleSelect';
import { MCP_MAX_OPERATIONS } from '@/lib/mcp/core/budget';

const checkboxClass = 'mt-0.5 h-4 w-4 shrink-0 accent-primary';
const textareaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export type McpPolicyValues = {
  enabled: boolean;
  dcrEnabled: boolean;
  dcrScopes: string[];
  sessionIdleDays: number;
  writesEnabled: boolean;
  sensitiveReadsEnabled: boolean;
  cimdAllowedHosts: string[];
  maxInFlight: number;
  maxOperations: number;
  requestsPerMinute: number;
  approvalTtlMinutes: number;
  approvalCommitWindowMinutes: number;
  allowedBrowserOrigins: string[];
  scopeStepUpEnabled: boolean;
};

/**
 * One policy group: title and explanation on the left, controls on the right (stacked on small
 * screens). The legend names the group once for assistive technology and the explanation is
 * read when focus enters it.
 */
function PolicyGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const descriptionId = `mcp-policy-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-description`;
  return (
    <fieldset
      aria-describedby={descriptionId}
      className="grid min-w-0 gap-4 border-b border-border py-6 last:border-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8"
    >
      {/* The legend must be the fieldset's first child to name it; the visible title is a
          presentational copy so the name is announced once. */}
      <legend className="sr-only">{title}</legend>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground" aria-hidden="true">
          {title}
        </p>
        <div id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </fieldset>
  );
}

function CheckRow({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/[0.03]">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className={checkboxClass}
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export default function McpPolicySection({
  policy,
  revision,
  scopeChoices,
  selectedScopes,
  action,
}: {
  policy: McpPolicyValues;
  /** The policyRevision this page was rendered from; a stale save is refused. */
  revision: number;
  scopeChoices: string[];
  selectedScopes: string[];
  action: McpPolicyAction;
}) {
  return (
    <McpPolicyForm action={action} revision={revision}>
      <PolicyGroup
        title="Assistant access"
        description="The master switch and how assistants identify themselves."
      >
        <CheckRow
          name="enabled"
          label="Enable MCP"
          description="Uncheck for an immediate MCP-only shutdown; the rest of OpsKnight is unaffected."
          defaultChecked={policy.enabled}
        />
        <CheckRow
          name="dcrEnabled"
          label="Automatic connections"
          description="Assistants connect with just the URL: no client ID, secret or callback setup. Each person still signs in and approves, and their own permissions apply. Turn off to disconnect every automatically connected assistant immediately."
          defaultChecked={policy.dcrEnabled}
        />
      </PolicyGroup>

      <PolicyGroup
        title="What assistants may do"
        description="The most an automatically connected assistant may request. People can approve less, and their own OpsKnight permissions always apply on top."
      >
        <McpPolicyScopeSelector scopeChoices={scopeChoices} selectedScopes={selectedScopes} />
      </PolicyGroup>

      <PolicyGroup
        title="Sign-in sessions"
        description="How long an unused connection stays signed in."
      >
        <SessionIdleSelect defaultValue={policy.sessionIdleDays} />
      </PolicyGroup>

      <details className="group border-t border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span className="flex flex-col">
            <span>Advanced</span>
            <span className="text-xs font-normal text-muted-foreground">
              Reviewed changes, sensitive reads, trusted hosts, browser clients and workload limits
            </span>
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t border-border">
          <PolicyGroup
            title="Reviewed actions"
            description="Off by default. Routine incident changes run directly. Configuration changes wait for an administrator to approve the exact, frozen request; runbook runs wait for anyone with runbook approve permission (Responders and Administrators by default). An administrator may approve their own request after confirming."
          >
            <CheckRow
              name="writesEnabled"
              label="Allow reviewed routine mutations and approved runbook executions"
              description="Assistants can acknowledge, assign, annotate, resolve and create incidents, and prepare configuration changes and runbook runs for review. Reviewers are notified in OpsKnight."
              defaultChecked={policy.writesEnabled}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-approval-ttl">Time to review (minutes)</Label>
                <Input
                  id="mcp-approval-ttl"
                  name="approvalTtlMinutes"
                  type="number"
                  min="15"
                  max="1440"
                  defaultValue={policy.approvalTtlMinutes}
                  aria-describedby="mcp-approval-ttl-help"
                  required
                />
                <p id="mcp-approval-ttl-help" className="text-xs text-muted-foreground">
                  How long a request waits for a reviewer, 15 to 1440 (24 hours).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-commit-window">Time to apply after approval (minutes)</Label>
                <Input
                  id="mcp-commit-window"
                  name="approvalCommitWindowMinutes"
                  type="number"
                  min="1"
                  max="1440"
                  defaultValue={policy.approvalCommitWindowMinutes}
                  aria-describedby="mcp-commit-window-help"
                  required
                />
                <p id="mcp-commit-window-help" className="text-xs text-muted-foreground">
                  Starts when the request is approved. Never later than 24 hours after the request.
                </p>
              </div>
            </div>
            <CheckRow
              name="sensitiveReadsEnabled"
              label="Allow reviewed sensitive configuration reads"
              description="Redacted, read-only, and limited to what the signed-in user can already see."
              defaultChecked={policy.sensitiveReadsEnabled}
            />
          </PolicyGroup>
          <PolicyGroup
            title="Trusted assistant hosts"
            description="Optionally limit which assistants may identify with a metadata document."
          >
            <div className="space-y-1.5">
              <Label htmlFor="mcp-cimd-hosts">
                Only trust these assistant hosts (optional, one DNS name per line)
              </Label>
              <textarea
                id="mcp-cimd-hosts"
                className={textareaClass}
                name="cimdAllowedHosts"
                rows={3}
                maxLength={4096}
                defaultValue={policy.cimdAllowedHosts.join('\n')}
                placeholder="claude.ai"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Leave empty to allow any assistant that identifies with an HTTPS metadata document.
                Documents are fetched without redirects from public addresses only.
              </p>
            </div>
          </PolicyGroup>
          <PolicyGroup
            title="Browser clients"
            description="Assistants that run in a web page, such as MCP Inspector, send their page's origin. Every origin not listed here is refused."
          >
            <div className="space-y-1.5">
              <Label htmlFor="mcp-browser-origins">
                Allowed browser origins (optional, one per line)
              </Label>
              <textarea
                id="mcp-browser-origins"
                className={textareaClass}
                name="allowedBrowserOrigins"
                rows={2}
                maxLength={4096}
                defaultValue={policy.allowedBrowserOrigins.join('\n')}
                placeholder="http://localhost:6274"
                aria-describedby="mcp-browser-origins-help"
              />
              <p
                id="mcp-browser-origins-help"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Exact origins (scheme, host and port), at most 10; plain http only on localhost.
                Listed pages may call the MCP endpoint and sign-in endpoints with their own tokens,
                never with a person&apos;s OpsKnight cookies. Consent and review pages stay
                same-origin only.
              </p>
            </div>
            <CheckRow
              name="scopeStepUpEnabled"
              label="Let assistants ask for a missing permission in place"
              description="When a call needs a permission the connection lacks but could be granted, answer with an upgrade request (HTTP 403 insufficient_scope) so assistants that support it re-open sign-in for just that permission. Off: the call returns a tool error and the person reconnects."
              defaultChecked={policy.scopeStepUpEnabled}
            />
          </PolicyGroup>
          <PolicyGroup
            title="Workload limits"
            description="Protects OpsKnight from busy or misbehaving assistants."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-max-in-flight">Concurrent requests per process</Label>
                <Input
                  id="mcp-max-in-flight"
                  name="maxInFlight"
                  type="number"
                  min="1"
                  max="16"
                  defaultValue={policy.maxInFlight}
                  aria-describedby="mcp-max-in-flight-help"
                  required
                />
                <p id="mcp-max-in-flight-help" className="text-xs text-muted-foreground">
                  Per web process. Cluster capacity = value × web replicas. Each process has an MCP
                  database pool of 2 connections (max 4); values above the pool size queue on
                  database connections.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-max-operations">Operations per request</Label>
                <Input
                  id="mcp-max-operations"
                  name="maxOperations"
                  type="number"
                  min="1"
                  max={MCP_MAX_OPERATIONS}
                  defaultValue={Math.min(policy.maxOperations, MCP_MAX_OPERATIONS)}
                  aria-describedby="mcp-max-operations-help"
                  required
                />
                <p id="mcp-max-operations-help" className="text-xs text-muted-foreground">
                  Up to {MCP_MAX_OPERATIONS}. Composite tools use several (incident context 3,
                  postmortem context 4).
                </p>
                {policy.maxOperations < 4 && (
                  <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                    {policy.maxOperations < 3
                      ? 'Below 3, incident_get_context, postmortem_get_context and approval commits stop working.'
                      : 'Below 4, postmortem_get_context stops working.'}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-rpm">Weighted operations per minute per grant</Label>
                <Input
                  id="mcp-rpm"
                  name="requestsPerMinute"
                  type="number"
                  min="1"
                  max="600"
                  defaultValue={policy.requestsPerMinute}
                  required
                />
              </div>
            </div>
          </PolicyGroup>
        </div>
      </details>
    </McpPolicyForm>
  );
}
