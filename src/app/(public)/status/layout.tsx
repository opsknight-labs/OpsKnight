import '@/styles/pages/status-page.css';
import { FORCE_LIGHT_THEME_SCRIPT } from '@/lib/theme-preference';

export default function PublicStatusLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Custom domains rewrite `/` here, so the head script sees `/` and may paint dark. */}
      <script dangerouslySetInnerHTML={{ __html: FORCE_LIGHT_THEME_SCRIPT }} />
      {children}
    </>
  );
}
