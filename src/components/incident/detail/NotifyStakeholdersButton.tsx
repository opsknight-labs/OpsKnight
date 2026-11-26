'use client';

import { useState, useTransition } from 'react';
import { Megaphone } from 'lucide-react';
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
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { notify } from '@/lib/toast';
import { notifyStakeholdersAction } from '@/app/(app)/incidents/[id]/stakeholder-actions';

const PHASES = [
  {
    value: 'investigating',
    label: 'Investigating',
    template: 'We are aware of a problem affecting {services} and are investigating.',
  },
  {
    value: 'identified',
    label: 'Identified',
    template:
      'We have found the cause of the problem affecting {services} and are working on a fix.',
  },
  {
    value: 'monitoring',
    label: 'Monitoring',
    template: 'A fix is in place for {services}. We are watching to confirm it holds.',
  },
  {
    value: 'resolved',
    label: 'Resolved',
    template: '{services} {verb} working normally again.',
  },
] as const;

type Phase = (typeof PHASES)[number]['value'];

function templateFor(phase: Phase, names: string[]) {
  const services =
    names.length > 2 ? `${names.slice(0, 2).join(', ')} and others` : names.join(' and ');
  return (
    PHASES.find(item => item.value === phase)!
      // Function replacers: a service name with `$&` or `$1` must stay literal.
      .template.replace('{services}', () => services)
      .replace('{verb}', () => (names.length > 1 ? 'are' : 'is'))
  );
}

/** Sends a templated business-impact update to followers and subscribed teams. Never pages. */
export default function NotifyStakeholdersButton({
  incidentId,
  businessServices,
}: {
  incidentId: string;
  businessServices: Array<{ id: string; name: string }>;
}) {
  const names = businessServices.map(service => service.name);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('investigating');
  const [message, setMessage] = useState(() => templateFor('investigating', names));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reseed on every open: the linked services may have changed since the last time, and an old error is not news.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setPhase('investigating');
      setMessage(templateFor('investigating', names));
      setError(null);
    }
    setOpen(next);
  };

  const send = () =>
    startTransition(async () => {
      setError(null);
      const result = await notifyStakeholdersAction(incidentId, {
        phase,
        message,
        // Send exactly the services the dialog lists; the server rejects any that stopped being impacted.
        businessServiceIds: businessServices.map(service => service.id),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success(
        result.recipientCount
          ? `Update sent to ${result.recipientCount} ${result.recipientCount === 1 ? 'person' : 'people'}`
          : 'Nobody follows these business services yet'
      );
      setOpen(false);
    });

  if (!businessServices.length) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs">
          <Megaphone className="h-3.5 w-3.5" aria-hidden />
          Notify stakeholders
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notify stakeholders</DialogTitle>
          <DialogDescription>
            Followers and subscribed teams of {names.join(', ')} get this by email and in the app.
            Nobody is paged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="stakeholder-phase">Stage</Label>
            <Select
              value={phase}
              onValueChange={value => {
                setPhase(value as Phase);
                setError(null);
                setMessage(templateFor(value as Phase, names));
              }}
            >
              <SelectTrigger id="stakeholder-phase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHASES.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stakeholder-message">Message</Label>
            <Textarea
              id="stakeholder-message"
              value={message}
              maxLength={2000}
              rows={4}
              onChange={event => {
                setMessage(event.target.value);
                setError(null);
              }}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={send} disabled={pending || !message.trim()}>
            {pending ? 'Sending…' : 'Send update'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
