import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import '@/styles/index.css';
import './layers.css';
import { Providers } from './providers';
import VersionCheck from '@/components/VersionCheck';
import ServiceWorkerBootstrap from '@/components/pwa/ServiceWorkerBootstrap';

// Brand typefaces, bundled so builds never depend on Google font downloads.
// Inter is the UI/body face; Space Grotesk is the display face for titles,
// badges and brand marks. See AGENTS.md "Typography".
const inter = localFont({
  src: [
    { path: './fonts/Inter-latin-normal.woff2', weight: '100 900', style: 'normal' },
    { path: './fonts/Inter-latin-italic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-inter',
  display: 'swap',
});
const spaceGrotesk = localFont({
  src: './fonts/SpaceGrotesk-latin.woff2',
  variable: '--font-space-grotesk',
  weight: '300 700',
  style: 'normal',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OpsKnight | Self-hosted incident operations',
  description:
    'Transparent incident operations from alert ingestion and on-call routing through response, customer communication, and learning.',
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
      { url: '/logo.png', type: 'image/png' },
    ],
    apple: '/icons/opsknight-apple-touch.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'OpsKnight',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta
          id="opsknight-runtime-theme-color"
          name="theme-color"
          content="#f8fafc"
          suppressHydrationWarning
        />
        <meta name="darkreader-lock" />
      </head>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <Providers>
          <VersionCheck />
          <ServiceWorkerBootstrap />
          {children}
        </Providers>
      </body>
    </html>
  );
}
