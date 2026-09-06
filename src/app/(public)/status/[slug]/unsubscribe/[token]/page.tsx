import { renderUnsubscribePage } from '@/app/(public)/status/unsubscribe/[token]/page';

export default async function SlugUnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; token: string }>;
  searchParams?: Promise<{ done?: string }>;
}) {
  const { slug, token } = await params;
  return renderUnsubscribePage(token, await searchParams, slug);
}
