import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google'; // [NEW]
import '@/styles/index.css';
import { Providers } from './providers';
import VersionCheck from '@/components/VersionCheck';

// Initialize fonts with explicit weights for better control
const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
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
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'OpsKnight',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta name="darkreader-lock" />
      </head>
      <body className={`${manrope.variable} antialiased`} suppressHydrationWarning>
        <Providers>
          <VersionCheck />
          {children}
        </Providers>
      </body>
    </html>
  );
}
