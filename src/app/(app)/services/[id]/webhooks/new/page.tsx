import prisma from '@/lib/prisma';
import Link from 'next/link';
import ServiceTabs from '@/components/service/ServiceTabs';
import { createWebhookIntegration } from '../actions';
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
import { ChevronLeft, AlertCircle, Webhook } from 'lucide-react';

export default async function NewWebhookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;
  const service = await prisma.service.findUnique({
    where: { id },
    select: { id: true, name: true },
  });

  if (!service) {
    return (
      <main className="container mx-auto max-w-4xl py-12 px-4">
        <Card className="text-center py-12">
          <CardContent className="flex flex-col items-center justify-center p-6 text-center">
            <h2 className="text-2xl font-bold mb-2">Service Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The service you're looking for doesn't exist.
            </p>
            <Button asChild>
              <Link href="/services">Back to Services</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const createWebhookWithId = createWebhookIntegration.bind(null, id);

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
        <span className="font-medium text-foreground">Add Webhook</span>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 text-zinc-100 shadow-xl ring-1 ring-white/5 md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.03] blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80 text-white border border-zinc-700/80 shadow-xs">
            <Webhook className="h-5 w-5 text-rose-500" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Inbound Integration
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Add Webhook Integration
            </h1>
            <p className="mt-1 text-xs md:text-sm text-zinc-300">
              Configure a webhook integration for {service.name}
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
            <CardDescription>Enter the details for your new webhook integration.</CardDescription>
          </CardHeader>

          <form action={createWebhookWithId}>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  name="name"
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
                <p className="text-xs text-muted-foreground">
                  Select the webhook service type for proper formatting
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">
                  Webhook URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="url"
                  name="url"
                  type="url"
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
                  placeholder="HMAC secret for signature verification"
                />
                <p className="text-xs text-muted-foreground">
                  Optional: Secret for HMAC signature verification
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="channel">Channel/Room Name (Optional)</Label>
                <Input id="channel" name="channel" placeholder="e.g., #incidents, General" />
                <p className="text-xs text-muted-foreground">
                  For Telegram, provide the target chat ID.
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex justify-between border-t p-6 bg-muted/20">
              <Button variant="ghost" asChild>
                <Link href={`/services/${id}/settings`}>Cancel</Link>
              </Button>
              <Button type="submit">Create Webhook</Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </main>
  );
}
