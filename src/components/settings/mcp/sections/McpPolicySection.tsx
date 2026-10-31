import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import McpPolicyForm from '@/components/settings/mcp/McpPolicyForm';
import McpPolicyScopeSelector from '@/components/settings/mcp/McpPolicyScopeSelector';
import SessionIdleSelect from '@/components/settings/mcp/SessionIdleSelect';

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
};

/**
 * One policy group: title and explanation on the left, controls on the right (stacked on small
 * screens). The fieldset keeps the group name for assistive technology.
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
  return (
    <fieldset className="grid min-w-0 gap-4 border-b border-border py-6 last:border-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8">
      <legend className="sr-only">{title}</legend>
      <div className="space-y-1" aria-hidden="true">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
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
  scopeChoices,
  selectedScopes,
  describeScope: _describeScope,
  action,
}: {
  policy: McpPolicyValues;
  scopeChoices: string[];
  selectedScopes: string[];
  describeScope?: (scope: string) => string;
  action: (form: FormData) => Promise<void>;
}) {
  return (
    <McpPolicyForm action={action}>
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
              Reviewed changes, sensitive reads, trusted hosts and workload limits
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
            description="Off by default. Every proposal waits for an administrator to approve the exact, frozen request."
          >
            <CheckRow
              name="writesEnabled"
              label="Allow reviewed routine mutations and approved runbook executions"
              description="Assistants can prepare changes; each one waits for approval by an administrator."
              defaultChecked={policy.writesEnabled}
            />
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
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-max-operations">Operations per request</Label>
                <Input
                  id="mcp-max-operations"
                  name="maxOperations"
                  type="number"
                  min="1"
                  max="16"
                  defaultValue={policy.maxOperations}
                  required
                />
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
