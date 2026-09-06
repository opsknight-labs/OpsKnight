import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OpsKnight',
    short_name: 'OpsKnight',
    description: 'Enterprise Incident Management & On-Call',
    start_url: '/m',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    orientation: 'portrait',
    scope: '/',
    icons: [
      {
        src: '/icons/app-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/app-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/app-icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/app-icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Mobile Dashboard',
        url: '/m',
        description: 'Open the mobile dashboard',
        icons: [{ src: '/icons/app-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
