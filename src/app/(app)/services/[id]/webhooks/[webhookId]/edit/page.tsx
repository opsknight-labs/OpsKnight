import prisma from '@/lib/prisma';
import Link from 'next/link';
import ServiceTabs from '@/components/service/ServiceTabs';
import DeleteWebhookButton from '@/components/service/DeleteWebhookButton';
import { updateWebhookIntegration, deleteWebhookIntegration } from '../../actions';
import { notFound } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { ChevronLeft, AlertCircle, Save, Webhook } from 'lucide-react';

export default async function EditWebhookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; webhookId: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { id, webhookId } = await params;
  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;

  const [service, webhook] = await Promise.all([
    prisma.service.findUnique({
      where: { id },
      select: { id: true, name: true },
    }),
    prisma.webhookIntegration.findUnique({
      where: { id: webhookId },
    }),
  ]);

  if (!service || !webhook || webhook.serviceId !== id) {
    notFound();
  }

  const updateWebhookWithIds = updateWebhookIntegration.bind(null, webhookId, id);
  const deleteWebhookWithIds = deleteWebhookIntegration.bind(null, webhookId, id);

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
        <span className="font-medium text-foreground">Edit Webhook</span>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-slate-800/90 bg-[#0b1120] p-4 text-slate-100 shadow-xl ring-1 ring-white/5 md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.03] blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-800/80 text-white border border-slate-700/80 shadow-xs">
            <Webhook className="h-5 w-5 text-rose-500" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Inbound Integration
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Edit Webhook Integration
            </h1>
            <p className="mt-1 text-xs md:text-sm text-slate-300">
              Update configuration for {webhook.name}
            </p>
          </div>
        </div>
      </div>

      <ServiceTabs serviceId={id} />

      <div className="max-w-3xl">
        {errorCode === 'duplicate-webhook' && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              A webhook integration with this name already exists. Please choose a unique name.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="border-b pb-6">
            <CardTitle>Webhook Configuration</CardTitle>
            <CardDescription>Update the details for your webhook integration.</CardDescription>
          </CardHeader>

          <form action={updateWebhookWithIds}>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={webhook.name}
                  required
                  placeholder="e.g., Google Chat, Microsoft Teams"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">
                  Type <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <select
                    name="type"
                    defaultValue={webhook.type}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    required
                  >
                    <option value="GENERIC">Generic Webhook</option>
                    <option value="GOOGLE_CHAT">Google Chat</option>
                    <option value="TEAMS">Microsoft Teams</option>
                    <option value="SLACK">Slack</option>
                    <option value="DISCORD">Discord</option>
                    <option value="TELEGRAM">Telegram</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">
                  Webhook URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="url"
                  name="url"
                  type="url"
                  defaultValue={webhook.url}
                  required
                  placeholder="https://..."
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secret">Secret (Optional)</Label>
                <Input
                  id="secret"
                  name="secret"
                  type="password"
                  defaultValue=""
                  placeholder={
                    webhook.secret
                      ? 'Configured — enter a new value to rotate'
                      : 'HMAC secret for signature verification'
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to preserve the configured secret. Stored values are never displayed.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="channel">Channel/Room Name (Optional)</Label>
                <Input
                  id="channel"
                  name="channel"
                  defaultValue={webhook.channel || ''}
                  placeholder="e.g., #incidents, General"
                />
                <p className="text-xs text-muted-foreground">
                  For Telegram, provide the target chat ID.
                </p>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="enabled"
                  name="enabled"
                  value="true"
                  defaultChecked={webhook.enabled}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="enabled" className="cursor-pointer font-medium">
                  Enable this integration
                </Label>
              </div>
            </CardContent>

            <CardFooter className="flex justify-between border-t p-6 bg-muted/20">
              <DeleteWebhookButton
                deleteAction={deleteWebhookWithIds}
                redirectTo={`/services/${id}/settings`}
              />
              <div className="flex gap-2">
                <Button variant="ghost" asChild>
                  <Link href={`/services/${id}/settings`}>Cancel</Link>
                </Button>
                <Button type="submit">
                  <Save className="mr-2 h-4 w-4" /> Save Changes
                </Button>
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </main>
  );
}
