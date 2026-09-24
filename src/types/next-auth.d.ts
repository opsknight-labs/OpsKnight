import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role?: string;
      tokenVersion?: number;
      avatarUrl?: string | null;
      gender?: string | null;
    };
    /** Error code if token validation failed or security lookup was unavailable */
    error?: string;
    /** Unix epoch seconds of the session's absolute expiry (Remember-Me hard cap). */
    absoluteExpiresAt?: number;
  }

  interface User {
    role?: string;
    tokenVersion?: number;
    avatarUrl?: string | null;
    gender?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string;
    tokenVersion?: number;
    avatarUrl?: string | null;
    gender?: string | null;
    authProvider?: 'oidc' | 'credentials';
  }
}
