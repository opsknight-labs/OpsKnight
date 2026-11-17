import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/m',
    name: 'OpsKnight',
    short_name: 'OpsKnight',
    description: 'Enterprise Incident Management & On-Call',
    start_url: '/m',
    display: 'standalone',
    // One value for both schemes (manifests cannot vary by colour scheme): the brand dark
    // ground, so the launch splash never flashes white. The page's media-aware
    // <meta name="theme-color"> takes over the browser chrome after first paint.
    background_color: '#09090b',
    theme_color: '#09090b',
    scope: '/',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icons/opsknight-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/opsknight-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/opsknight-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/opsknight-maskable-512.png',
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
        icons: [{ src: '/icons/opsknight-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'My on-call',
        short_name: 'On-call',
        url: '/m/schedules',
        description: 'Open on-call schedules',
        icons: [{ src: '/icons/opsknight-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Notifications',
        short_name: 'Alerts',
        url: '/m/notifications',
        description: 'Open OpsKnight notifications',
        icons: [{ src: '/icons/opsknight-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
