import NextAuth from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';

const handler = async (req: Request, context: { params: Promise<{ nextauth: string[] }> }) => {
  const params = await context.params;
  const route = params.nextauth?.join('/') || 'unknown';

  logger.debug('[Auth] NextAuth route accessed', {
    component: 'nextauth-handler',
    route,
    method: req.method,
  });

  const options = await getAuthOptions();
  const nextAuthHandler = NextAuth(options);
  return nextAuthHandler(req, { params });
};

export { handler as GET, handler as POST };
