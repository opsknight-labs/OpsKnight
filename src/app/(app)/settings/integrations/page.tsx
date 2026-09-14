import { redirect } from 'next/navigation';

export default function IntegrationsRootPage() {
  redirect('/settings/integrations/slack');
}
