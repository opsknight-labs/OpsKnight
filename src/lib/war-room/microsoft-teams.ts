import 'server-only';

// Thin facade — canonical implementation lives in providers/microsoft-teams/provision.
// Kept for backward compatibility with routes and tests that import from '@/lib/war-room/microsoft-teams'.
export * from './providers/microsoft-teams/provision';
