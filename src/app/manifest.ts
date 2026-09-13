import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/m',
    name: 'OpsKnight',
    short_name: 'OpsKnight',
    description: 'Enterprise Incident Management & On-Call',
    start_url: '/m',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    scope: '/',
    categories: ['business', 'productivity', 'utilities'],
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
        name: 'Open incidents',
        short_name: 'Incidents',
        url: '/m/incidents?filter=all_open',
        description: 'Open the active incident queue',
        icons: [{ src: '/icons/app-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'My on-call',
        short_name: 'On-call',
        url: '/m/schedules',
        description: 'Open on-call schedules',
        icons: [{ src: '/icons/app-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Notifications',
        short_name: 'Alerts',
        url: '/m/notifications',
        description: 'Open OpsKnight notifications',
        icons: [{ src: '/icons/app-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
