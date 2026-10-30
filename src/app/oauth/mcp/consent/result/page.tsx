import { friendlyMcpError } from '@/lib/mcp/auth/friendly-error';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Assistant connection | OpsKnight',
  referrer: 'no-referrer' as const,
};

export default async function McpConsentResult({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code = '' } = await searchParams;
  const { title, body } = friendlyMcpError(code.slice(0, 64));
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <section role="alert" className="space-y-2 rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </section>
    </main>
  );
}
