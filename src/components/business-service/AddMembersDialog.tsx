'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Switch } from '@/components/ui/shadcn/switch';
import { MultiPicker } from '@/components/service/MultiPicker';
import { notify } from '@/lib/toast';
import { addBusinessServiceMembersAction } from '@/app/(app)/services/business/actions';

/** "Add services" on the Members tab: pick services and whether they can take this one down. */
export default function AddMembersDialog({
  businessServiceId,
  existingIds,
}: {
  businessServiceId: string;
  /** Current members; left out of the picker. */
  existingIds: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [critical, setCritical] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const existing = new Set(existingIds);
  const fresh = picked.filter(id => !existing.has(id));

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await addBusinessServiceMembersAction(businessServiceId, {
        serviceIds: fresh,
        critical,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success(`Added ${fresh.length} service${fresh.length === 1 ? '' : 's'}`);
      setOpen(false);
      setPicked([]);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add services
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add technical services</DialogTitle>
          <DialogDescription>
            Their incidents will count towards this business service&apos;s health.
          </DialogDescription>
        </DialogHeader>
        <MultiPicker
          label="Services"
          description="Search by service or team name."
          options={[]}
          kind="services"
          value={picked}
          onChange={setPicked}
          emptyText="Type to search services."
        />
        {picked.length > fresh.length && (
          <p className="text-xs text-muted-foreground">
            {picked.length - fresh.length} already a member and will be skipped.
          </p>
        )}
        <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="min-w-0">
            <p id="add-members-critical" className="text-sm font-medium">
              Can take it down
            </p>
            <p className="text-xs text-muted-foreground">
              {critical
                ? 'Critical: an outage on one of these can mean an outage here.'
                : 'Non-critical: they can make it degraded at most.'}
            </p>
          </div>
          <Switch
            checked={critical}
            onCheckedChange={setCritical}
            aria-labelledby="add-members-critical"
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={isPending || fresh.length === 0} onClick={submit}>
            {isPending
              ? 'Adding…'
              : fresh.length
                ? `Add ${fresh.length} service${fresh.length === 1 ? '' : 's'}`
                : 'Add services'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
