import { renderVerifySubscriptionPage } from '@/app/(public)/status/verify/[token]/page';

export default async function SlugVerifySubscriptionPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  return renderVerifySubscriptionPage(token, slug);
}
