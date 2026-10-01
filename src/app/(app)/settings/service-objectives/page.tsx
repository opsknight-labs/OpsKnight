import { redirect } from 'next/navigation';

export const revalidate = 0;

export default async function ServiceObjectivesPage() {
  // Service objectives UI is deferred to a future release
  redirect('/settings');
}
