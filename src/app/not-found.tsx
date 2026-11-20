import { headers } from 'next/headers';
import ErrorPageShell from '@/components/errors/ErrorPageShell';

export default async function NotFound() {
  const requestId = (await headers()).get('x-request-id');
  return (
    <ErrorPageShell
      code="404"
      title="We can't find that page"
      message="The link may be out of date, or the page may have moved. Head back to the dashboard or check the help centre."
      requestId={requestId}
    />
  );
}
