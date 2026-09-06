'use client';

import { useState } from 'react';
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Plus, X, Lightbulb, Zap } from 'lucide-react';

type CreateServiceFormProps = {
  teams: Array<{ id: string; name: string }>;
  policies: Array<{ id: string; name: string }>;
  createAction: (formData: FormData) => void;
};

export default function CreateServiceForm({
  teams,
  policies,
  createAction,
}: CreateServiceFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [slaTier, setSlaTier] = useState('');
  const [escalationPolicyId, setEscalationPolicyId] = useState('');

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        className="w-full h-auto py-8 border-dashed border-2 hover:border-primary hover:bg-primary/5 flex flex-col gap-2 group transition-all"
        onClick={() => setIsOpen(true)}
      >
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          <Plus className="h-6 w-6" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-lg">Create New Service</h3>
          <p className="text-muted-foreground text-sm">
            Add a new service to monitor and manage incidents
          </p>
        </div>
      </Button>
    );
  }

  return (
    <Card className="border-primary/20 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/40 to-primary" />
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Create New Service</CardTitle>
            <CardDescription>
              Configure basic settings for your new service. Additional options available after
              creation.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <form action={createAction}>
        <input type="hidden" name="teamId" value={teamId === 'unassigned' ? '' : teamId} />
        <input type="hidden" name="slaTier" value={slaTier} />
        <input
          type="hidden"
          name="escalationPolicyId"
          value={escalationPolicyId === 'none' ? '' : escalationPolicyId}
        />
        <CardContent className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">
                Service Name <span className="text-destructive">*</span>
              </Label>
              <Input id="name" name="name" required placeholder="e.g. API Gateway" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="teamId">Owner Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
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
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                placeholder="Brief description of the service"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region</Label>
              <Input
                id="region"
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
              <p className="text-[0.8rem] text-muted-foreground">
                Optional. Used to display impacted regions.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="slaTier">SLA Tier</Label>
              <Select value={slaTier} onValueChange={setSlaTier}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Platinum">Platinum (99.99%)</SelectItem>
                  <SelectItem value="Gold">Gold (99.9%)</SelectItem>
                  <SelectItem value="Silver">Silver (99.5%)</SelectItem>
                  <SelectItem value="Bronze">Bronze (99.0%)</SelectItem>
                  <SelectItem value="Internal">Internal (Best Effort)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[0.8rem] text-muted-foreground">
                Optional. Defines availability expectations.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="escalationPolicyId" className="flex items-center gap-2">
                Escalation Policy
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground cursor-help"
                  title="Defines who gets notified when incidents occur"
                >
                  ?
                </span>
              </Label>
              <Select value={escalationPolicyId} onValueChange={setEscalationPolicyId}>
                <SelectTrigger>
                  <SelectValue placeholder="No escalation policy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No escalation policy</SelectItem>
                  {policies.map(policy => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-[0.8rem] text-muted-foreground">
                <Link href="/policies" className="text-primary hover:underline font-medium">
                  Manage policies
                </Link>
              </div>
            </div>
          </div>

          <Alert className="bg-amber-50 border-amber-200 text-amber-900">
            <Lightbulb className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800 font-semibold flex items-center gap-2">
              Pro Tip: Notifications
            </AlertTitle>
            <AlertDescription className="text-amber-800/90 mt-1">
              Once created, navigate to service settings to configure Slack, Microsoft Teams, and
              webhook notifications.
            </AlertDescription>
          </Alert>
        </CardContent>

        <CardFooter className="flex justify-end gap-3 bg-muted/40 p-4">
          <Button variant="ghost" onClick={() => setIsOpen(false)} type="button">
            Cancel
          </Button>
          <Button type="submit">
            <Zap className="mr-2 h-4 w-4" /> Create Service
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
