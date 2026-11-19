import type { Metadata } from 'next';
import AccessDeniedLoader from '@/components/access/AccessDeniedLoader';

export const metadata: Metadata = { title: 'Access denied' };

export default function Forbidden() {
  return <AccessDeniedLoader variant="mobile" />;
}
