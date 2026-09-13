import LoginPage from '@/app/login/page';

export const dynamic = 'force-dynamic';

/**
 * Compatibility route for older installed PWAs and mobile bookmarks.
 * Authentication UI, validation, SSO, break-glass rules and callback
 * sanitization are owned exclusively by the canonical /login page.
 */
export default LoginPage;
