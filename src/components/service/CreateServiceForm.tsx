'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Plus } from 'lucide-react';
import EscalationPolicyCombobox from '@/components/service/EscalationPolicyCombobox';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {!pending && <Plus aria-hidden="true" />}
      {pending ? 'Creating service…' : 'Create service'}
    </Button>
  );
}

type CreateServiceFormProps = {
  teams: Array<{ id: string; name: string }>;
  policies: Array<{ id: string; name: string }>;
  createAction: (formData: FormData) => Promise<void> | void;
  /** Classes for the trigger button (e.g. when placed on the dark page header). */
  triggerClassName?: string;
};

export default function CreateServiceForm({
  teams,
  policies,
  createAction,
  triggerClassName,
}: CreateServiceFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [slaTier, setSlaTier] = useState('');
  const [escalationPolicyId, setEscalationPolicyId] = useState('');

  const reset = () => {
    setTeamId('');
    setSlaTier('');
    setEscalationPolicyId('');
  };

  // The server action redirects back to the list (or to `?error=`); close either way.
  const submit = async (formData: FormData) => {
    try {
      await createAction(formData);
    } finally {
      setIsOpen(false);
      reset();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className={triggerClassName}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New service
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New service</DialogTitle>
          <DialogDescription>
            Name the service and choose who owns it. Integrations, notifications and webhooks are
            set up from the service page after it is created.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-5">
          <input type="hidden" name="teamId" value={teamId === 'unassigned' ? '' : teamId} />
          <input type="hidden" name="slaTier" value={slaTier} />
          <input
            type="hidden"
            name="escalationPolicyId"
            value={escalationPolicyId === 'none' ? '' : escalationPolicyId}
          />
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="service-name">
                Service name <span className="text-destructive">*</span>
              </Label>
              <Input id="service-name" name="name" required placeholder="e.g. API Gateway" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-team">Owner team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="service-team">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teams.map(team => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-description">Description</Label>
              <Input
                id="service-description"
                name="description"
                placeholder="Brief description of the service"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-region">Region</Label>
              <Input
                id="service-region"
                name="region"
                list="regions-list"
                placeholder="Select or enter region"
              />
              <datalist id="regions-list">
                <option value="Global" />
                <option value="US" />
                <option value="US-East (N. Virginia)" />
                <option value="US-East (Ohio)" />
                <option value="US-West (Oregon)" />
                <option value="US-West (N. California)" />
                <option value="US-Central" />
                <option value="CA (Canada)" />
                <option value="EU" />
                <option value="EU-West (Ireland)" />
                <option value="EU-West (London)" />
                <option value="EU-West (Paris)" />
                <option value="EU-Central (Frankfurt)" />
                <option value="EU-North (Stockholm)" />
                <option value="EU-South (Milan)" />
                <option value="APAC" />
                <option value="Asia Pacific (Tokyo)" />
                <option value="Asia Pacific (Singapore)" />
                <option value="Asia Pacific (Sydney)" />
                <option value="Asia Pacific (Seoul)" />
                <option value="Asia Pacific (Mumbai)" />
                <option value="Asia Pacific (Hong Kong)" />
                <option value="SA (South America)" />
                <option value="SA-East (Sao Paulo)" />
                <option value="ME (Middle East)" />
                <option value="AF (Africa)" />
              </datalist>
              <p className="text-xs text-muted-foreground">
                Optional. Used to display impacted regions.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-tier">Service tier</Label>
              <p className="text-xs text-muted-foreground">
                Informational service classification. Does not control incident response SLA.
              </p>
              <Select value={slaTier} onValueChange={setSlaTier}>
                <SelectTrigger id="service-tier">
                  <SelectValue placeholder="Select tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Platinum">Platinum (99.99%)</SelectItem>
                  <SelectItem value="Gold">Gold (99.9%)</SelectItem>
                  <SelectItem value="Silver">Silver (99.5%)</SelectItem>
                  <SelectItem value="Bronze">Bronze (99.0%)</SelectItem>
                  <SelectItem value="Internal">Internal (Best Effort)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. Defines availability expectations.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="createServiceEscalationPolicyId">Escalation policy</Label>
              <EscalationPolicyCombobox
                policies={policies}
                value={escalationPolicyId}
                onChange={setEscalationPolicyId}
                id="createServiceEscalationPolicyId"
                name=""
                placeholder="No escalation policy"
              />
              <p className="text-xs text-muted-foreground">
                Decides who is paged when an incident opens.{' '}
                <Link
                  href="/policies"
                  className="rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Manage policies
                </Link>
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-border pt-4 sm:gap-0">
            <Button variant="ghost" onClick={() => setIsOpen(false)} type="button">
              Cancel
            </Button>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
