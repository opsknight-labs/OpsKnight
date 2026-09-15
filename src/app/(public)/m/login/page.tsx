import LoginPage from '@/app/login/page';

export const dynamic = 'force-dynamic';

type SearchParams = {
  callbackUrl?: string;
  error?: string;
  password?: string;
};

/**
 * Mobile and installed PWA login surface. Authenticates using canonical auth
 * security policies while ensuring the post-login destination defaults to /m.
 */
export default async function MobileLoginPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  return <LoginPage searchParams={searchParams} defaultCallbackUrl="/m" />;
}
