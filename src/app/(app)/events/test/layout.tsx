import { requirePageAccess } from '@/lib/access/server';

/** The test console is a client page; its access rule is enforced here. */
export default async function EventTestLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess('/events/test');
  return children;
}
