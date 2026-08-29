'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Shield, Plus, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type ServiceOption = {
  id: string;
  name: string;
  description?: string | null;
  teamId?: string | null;
  team?: { name: string } | null;
};

type TeamAssignServicesModalProps = {
  teamId: string;
  teamName: string;
  availableServices: ServiceOption[];
  canManage: boolean;
  assignServicesAction: (
    teamId: string,
    serviceIds: string[]
  ) => Promise<{ error?: string } | undefined>;
};

export default function TeamAssignServicesModal({
  teamId,
  teamName,
  availableServices,
  canManage,
  assignServicesAction,
}: TeamAssignServicesModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  if (!canManage) return null;

  const toggleService = (serviceId: string) => {
    setSelectedIds(prev =>
      prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
    );
  };

  const handleAssign = () => {
    if (selectedIds.length === 0) {
      return showToast('Please select at least one service', 'error');
    }

    startTransition(async () => {
      try {
        const res = await assignServicesAction(teamId, selectedIds);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast(
            `Assigned ${selectedIds.length} service${selectedIds.length === 1 ? '' : 's'} to ${teamName}`,
            'success'
          );
          setSelectedIds([]);
          setOpen(false);
          router.refresh();
        }
      } catch {
        showToast('Failed to assign services', 'error');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs font-medium gap-1.5 shadow-2xs">
          <Plus className="h-3.5 w-3.5" />
          Assign Services
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Assign Services to {teamName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Select services to assign ownership and escalation routing to this team.
          </DialogDescription>
        </DialogHeader>

        {availableServices.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
            No other services available to assign.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 divide-y divide-border/40">
            {availableServices.map(service => {
              const isSelected = selectedIds.includes(service.id);
              return (
                <div
                  key={service.id}
                  onClick={() => toggleService(service.id)}
                  className={cn(
                    'flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors text-xs select-none',
                    isSelected
                      ? 'bg-primary/10 border border-primary/30 text-primary font-medium'
                      : 'hover:bg-muted/40 border border-transparent text-foreground'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Shield
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        isSelected ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{service.name}</p>
                      {service.team && (
                        <p className="text-[10px] text-muted-foreground">
                          Currently: {service.team.name}
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    className={cn(
                      'h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      isSelected
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-muted-foreground/40'
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleAssign}
            disabled={selectedIds.length === 0 || isPending}
            className="text-xs gap-1.5"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Assigning...
              </>
            ) : (
              `Assign (${selectedIds.length})`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
