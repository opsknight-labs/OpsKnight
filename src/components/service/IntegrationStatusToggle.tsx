'use client';

import { useState } from 'react';
import { Switch } from '@/components/ui/shadcn/switch';
import { toggleIntegrationStatus } from '@/app/(app)/services/actions';
import { useToast } from '@/hooks/use-product-notification';
import { Badge } from '@/components/ui/shadcn/badge';

interface IntegrationStatusToggleProps {
  integrationId: string;
  serviceId: string;
  initialEnabled: boolean;
  canManage: boolean;
}

export default function IntegrationStatusToggle({
  integrationId,
  serviceId,
  initialEnabled,
  canManage,
}: IntegrationStatusToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleToggle = async (checked: boolean) => {
    if (!canManage) return;

    setLoading(true);
    // Optimistic update
    setEnabled(checked);

    try {
      await toggleIntegrationStatus(integrationId, serviceId, checked);
      showToast(
        checked ? 'Integration enabled' : 'Integration disabled',
        checked ? 'success' : 'info'
      );
    } catch (error) {
      // Revert on error
      setEnabled(!checked);
      showToast('Failed to update status', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
      {canManage ? (
        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={loading}
            className="data-[state=checked]:bg-emerald-500 scale-75 origin-right"
          />
          <Badge
            variant="outline"
            className={`
              text-[10px] px-2 py-0.5 h-5 font-medium border-0 transition-colors
              ${
                enabled
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
                  : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
              }
            `}
          >
            {enabled && (
              <span className="relative flex h-1.5 w-1.5 mr-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
            )}
            {enabled ? 'Active' : 'Disabled'}
          </Badge>
        </div>
      ) : (
        <Badge
          variant="outline"
          className={`
            text-[10px] px-2 py-0.5 h-5 font-medium border-0
            ${
              enabled
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
                : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
            }
          `}
        >
          {enabled ? 'Active' : 'Disabled'}
        </Badge>
      )}
    </div>
  );
}
