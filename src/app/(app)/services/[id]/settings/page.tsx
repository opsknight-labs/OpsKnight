import prisma from '@/lib/prisma';
import Link from 'next/link';
import ServiceTabs from '@/components/service/ServiceTabs';
import ServiceNotificationSettings from '@/components/service/ServiceNotificationSettings';
import JiraServiceMappingSettings from '@/components/service/JiraServiceMappingSettings';
import ChatOpsWarRoomSettings from '@/components/service/ChatOpsWarRoomSettings';
import { updateService } from '../../actions';
import { getUserPermissions } from '@/lib/rbac';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  ChevronLeft,
  Save,
  AlertCircle,
  CheckCircle2,
  Settings,
  Shield,
  Users,
  Puzzle,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';

export default async function ServiceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const showSaved = resolvedSearchParams?.saved === '1';
  const errorCode = resolvedSearchParams?.error;

  const [service, teams, policies, globalSlackIntegration, jiraConfig, permissions, chatOpsConfig] =
    await Promise.all([
      prisma.service.findUnique({
        where: { id: id },
        include: {
          policy: {
            select: { id: true, name: true },
          },
          webhookIntegrations: {
            where: { enabled: true },
            orderBy: { createdAt: 'desc' },
          },
          jiraServiceMapping: true,
        },
      }),
      prisma.team.findMany({ orderBy: { name: 'asc' } }),
      prisma.escalationPolicy.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.slackIntegration.findFirst({
        where: {
          enabled: true,
          services: { none: {} },
        },
        select: {
          id: true,
          workspaceName: true,
          workspaceId: true,
          enabled: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.jiraConfig.findUnique({
        where: { id: 'default' },
        select: { enabled: true },
      }),
      getUserPermissions(),
      prisma.chatOpsConfig.findUnique({
        where: { id: 'default' },
        select: { enabled: true },
      }),
    ]);

  // Get webhook integrations separately (already included in service)
  const webhookIntegrations = service?.webhookIntegrations || [];

  if (!service) {
    return (
      <main className="p-8 max-w-4xl mx-auto">
        <Card className="text-center py-12">
          <div className="flex flex-col items-center justify-center p-6">
            <h2 className="text-2xl font-semibold mb-2">Service Not Found</h2>
            <p className="text-slate-500 mb-6">
              The service you&apos;re looking for doesn&apos;t exist.
            </p>
            <Button asChild>
              <Link href="/services">Back to Services</Link>
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  const updateServiceWithId = updateService.bind(null, id);
  const canManage = permissions.isResponderOrAbove;

  return (
    <main className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/services"
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Services
        </Link>
        <span className="opacity-30">/</span>
        <Link href={`/services/${id}`} className="hover:text-primary transition-colors">
          {service.name}
        </Link>
        <span className="opacity-30">/</span>
        <span className="font-medium text-foreground">Settings</span>
      </div>

      <div className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground rounded-lg p-4 md:p-6 shadow-lg">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              Service Settings
            </h1>
            <p className="text-xs md:text-sm opacity-90 mt-1">
              Manage configuration, ownership, and notifications for {service.name}
            </p>
          </div>
        </div>
      </div>

      <ServiceTabs serviceId={id} />

      <div className="space-y-6">
        {/* Alerts */}
        {showSaved && (
          <Alert className="bg-emerald-50 border-emerald-200 text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle className="text-emerald-900 font-medium">Success</AlertTitle>
            <AlertDescription>Service settings saved successfully.</AlertDescription>
          </Alert>
        )}

        {errorCode === 'duplicate-service' && (
          <Alert variant="destructive" className="bg-red-50 border-red-200 text-red-900">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-900 font-medium">Error</AlertTitle>
            <AlertDescription>
              A service with this name already exists. Please choose a unique name.
            </AlertDescription>
          </Alert>
        )}

        <form action={updateServiceWithId} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* General Configuration Card */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="h-4 w-4 text-slate-500" /> General Configuration
                </CardTitle>
                <CardDescription>Basic information about your service</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Service Name <span className="text-red-500">*</span>
                  </Label>
                  <Input id="name" name="name" defaultValue={service.name} required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    defaultValue={service.description || ''}
                    rows={3}
                    placeholder="Describe what this service does..."
                    className="resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="region">Region</Label>
                    <Input
                      id="region"
                      name="region"
                      defaultValue={service.region || ''}
                      placeholder="Select or enter region"
                      list="regions-list"
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
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="slaTier">SLA Tier</Label>
                    <div className="relative">
                      <select
                        id="slaTier"
                        name="slaTier"
                        defaultValue={service.slaTier || ''}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">-- Select Tier --</option>
                        <option value="Platinum">Platinum (99.99%)</option>
                        <option value="Gold">Gold (99.9%)</option>
                        <option value="Silver">Silver (99.5%)</option>
                        <option value="Bronze">Bronze (99.0%)</option>
                        <option value="Internal">Internal (Best Effort)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Ownership Card */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-4 w-4 text-slate-500" /> Ownership & Escalation
                </CardTitle>
                <CardDescription>
                  Define who owns this service and how incidents are escalated
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="teamId">Owning Team</Label>
                  <div className="relative">
                    <select
                      id="teamId"
                      name="teamId"
                      defaultValue={service.teamId || ''}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">-- Select a Team --</option>
                      {teams.map(team => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="escalationPolicyId">Escalation Policy</Label>
                  <div className="relative">
                    <select
                      id="escalationPolicyId"
                      name="escalationPolicyId"
                      defaultValue={service.escalationPolicyId || ''}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">-- No Policy (Manual Paging Only) --</option>
                      {policies.map(policy => (
                        <option key={policy.id} value={policy.id}>
                          {policy.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="bg-slate-50 border rounded-md p-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2 mb-1 font-medium text-slate-900">
                    <Shield className="h-3.5 w-3.5" /> Policy Impact
                  </div>
                  Changes to escalation policies take effect immediately for new incidents. Existing
                  incidents verify policies at each step.
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Integrations & Workflows Section: Slack & Jira Side-by-Side */}
          <div className="mt-8 pt-6 border-t space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Puzzle className="h-5 w-5 text-primary" /> Service Integrations & Workflows
              </h2>
              <p className="text-sm text-muted-foreground">
                Configure notification channels (Slack) and engineering issue tracking (Jira)
                side-by-side.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Slack Notification Settings */}
              <ServiceNotificationSettings
                serviceId={service.id}
                serviceNotificationChannels={service.serviceNotificationChannels}
                serviceNotifyOnTriggered={service.serviceNotifyOnTriggered}
                serviceNotifyOnAck={service.serviceNotifyOnAck}
                serviceNotifyOnResolved={service.serviceNotifyOnResolved}
                serviceNotifyOnSlaBreach={service.serviceNotifyOnSlaBreach}
                slackChannel={service.slackChannel || null}
                slackWebhookUrl={service.slackWebhookUrl}
                slackIntegration={globalSlackIntegration}
                webhookIntegrations={webhookIntegrations}
              />

              {/* Jira Service Mapping Settings */}
              <JiraServiceMappingSettings
                serviceId={service.id}
                mapping={service.jiraServiceMapping}
                jiraEnabled={jiraConfig?.enabled ?? false}
                canManage={canManage}
              />
            </div>

            {/* ChatOps War-Room Settings */}
            <ChatOpsWarRoomSettings
              serviceId={service.id}
              autoCreateWarRoom={service.autoCreateWarRoom}
              warRoomVideoBridge={service.warRoomVideoBridge}
              warRoomCustomBridgeUrl={service.warRoomCustomBridgeUrl}
              chatOpsEnabled={chatOpsConfig?.enabled ?? false}
              canManage={canManage}
            />
          </div>

          <div className="flex items-center justify-end pt-4 gap-4 border-t mt-8">
            <Button variant="outline" asChild>
              <Link href={`/services/${id}`}>Cancel</Link>
            </Button>
            <Button type="submit" className="min-w-[120px]">
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
