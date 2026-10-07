import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import '@/styles/index.css';
import './layers.css';
import { Providers } from './providers';
import VersionCheck from '@/components/VersionCheck';
import ServiceWorkerBootstrap from '@/components/pwa/ServiceWorkerBootstrap';

const manrope = localFont({
  src: './fonts/Manrope-variable.ttf',
  variable: '--font-manrope',
  weight: '400 800',
  display: 'swap',
});
const playfair = localFont({
  src: [
    { path: './fonts/PlayfairDisplay-variable.ttf', weight: '400 700', style: 'normal' },
    { path: './fonts/PlayfairDisplay-Italic-variable.ttf', weight: '400 700', style: 'italic' },
  ],
  variable: '--font-serif',
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
    <html lang="en" suppressHydrationWarning>
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
        className={`${manrope.variable} ${playfair.variable} antialiased`}
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
