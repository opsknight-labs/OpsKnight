'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bot } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/shadcn/select';
import { AssistantIcon, getAssistantIcon } from '@/components/common/BrandLogos';
import { mcpHref, type GrantStatus } from '@/app/(app)/settings/integrations/mcp/list-params';

export { AssistantIcon, getAssistantIcon };

function AssistantFilterSelect({
  clients,
  selectedClientId,
  status,
  q,
}: {
  clients: { id: string; name: string }[];
  selectedClientId: string | null;
  status?: GrantStatus;
  q?: string;
}) {
  const router = useRouter();

  const handleValueChange = useCallback(
    (value: string) => {
      const nextClientId = value === 'all' ? null : value;
      const nextHref = mcpHref({
        tab: 'connections',
        status: status === 'active' ? null : status,
        q: q || null,
        client: nextClientId,
      });
      router.push(nextHref);
    },
    [router, status, q]
  );

  if (clients.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="mcp-assistant-select" className="sr-only">
        Filter by Assistant
      </label>
      <Select value={selectedClientId ?? 'all'} onValueChange={handleValueChange}>
        <SelectTrigger
          id="mcp-assistant-select"
          className="h-8 min-w-[170px] max-w-[240px] gap-2 rounded-lg border-border/80 bg-background text-xs font-medium hover:border-primary/40 focus:ring-1 focus:ring-primary"
        >
          <div className="flex items-center gap-2 truncate">
            {selectedClientId && selectedClientId !== 'all' ? (
              <>
                {getAssistantIcon(
                  clients.find(c => c.id === selectedClientId)?.name ?? '',
                  'h-3.5 w-3.5 shrink-0'
                )}
                <span className="truncate">
                  {clients.find(c => c.id === selectedClientId)?.name ?? 'Selected'}
                </span>
              </>
            ) : (
              <>
                <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">All Assistants</span>
              </>
            )}
          </div>
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="end"
          className="max-h-64 min-w-[200px] overflow-y-auto overscroll-contain p-1 rounded-xl border-border/80 shadow-xl"
        >
          <SelectGroup>
            <SelectLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Filter by Assistant
            </SelectLabel>
            <SelectItem value="all" className="rounded-lg text-xs font-medium cursor-pointer">
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <span>All Assistants</span>
              </div>
            </SelectItem>
            {clients.map(client => (
              <SelectItem
                key={client.id}
                value={client.id}
                className="rounded-lg text-xs font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  {getAssistantIcon(client.name, 'h-3.5 w-3.5 shrink-0')}
                  <span className="truncate">{client.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

export default React.memo(AssistantFilterSelect);
