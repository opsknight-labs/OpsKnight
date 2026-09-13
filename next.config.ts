import path from 'path';

import type { NextConfig } from 'next';

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  // Disable in dev to avoid caching issues; allow explicit override.
  disable: process.env.NODE_ENV === 'development' || process.env.DISABLE_PWA === 'true',
  register: true,
  // Never replace a running operational client underneath a responder. The
  // MobilePwaCoordinator explicitly activates a waiting worker after consent.
  skipWaiting: false,
  sw: 'sw.js',
  workboxOptions: {
    disableDevLogs: true,
    additionalManifestEntries: [],
    importScripts: ['/custom-sw.js'],
    // Dynamic pages, RSC streams, and APIs are authoritative network data.
    runtimeCaching: [
      {
        urlPattern: /^\/api\/.*/i,
        handler: 'NetworkOnly',
        options: { cacheName: 'no-cache-apis' },
      },
      {
        urlPattern: ({ request, url }: { request: Request; url: URL }) =>
          request.headers.get('RSC') === '1' ||
          url.searchParams.has('_rsc') ||
          request.headers.get('Next-Router-Prefetch') === '1',
        handler: 'NetworkOnly',
        options: { cacheName: 'no-cache-rsc' },
      },
      {
        urlPattern: ({ url }: { url: URL }) =>
          url.pathname === '/' ||
          url.pathname === '/m' ||
          url.pathname.startsWith('/login') ||
          url.pathname.startsWith('/auth') ||
          url.pathname.startsWith('/m/') ||
          url.pathname.startsWith('/incidents') ||
          url.pathname.startsWith('/settings') ||
          url.pathname.startsWith('/services') ||
          url.pathname.startsWith('/teams') ||
          url.pathname.startsWith('/users') ||
          url.pathname.startsWith('/schedules') ||
          url.pathname.startsWith('/policies'),
        handler: 'NetworkOnly',
        options: { cacheName: 'no-cache-pages' },
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-webfonts',
          expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'google-fonts-stylesheets',
          expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /\/_next\/static\/.+\.(?:js|css)$/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'next-static-assets',
          expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-images',
          expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
    ],
  },
  // next-pwa defaults can cache RSC/HTML auth redirects; never inherit them.
  extendDefaultRuntimeCaching: false,
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  // Reconnection syncs data/actions; it must not destroy an in-progress form.
  reloadOnOnline: false,
  swcMinify: true,
  fallbacks: {},
  cacheStartUrl: false,
  dynamicStartUrl: false,
});

const nextConfig: NextConfig = {
  distDir: process.env.BUILD_DIR || '.next',
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    optimizePackageImports: ['@prisma/client', 'react-icons'],
    serverActions: { bodySizeLimit: '2mb' },
  },
  turbopack: {},
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },
  images: {
    localPatterns: [
      { pathname: '/logo.png' },
      { pathname: '/api/avatar', search: '?**' },
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
    ],
  },
  async headers() {
    const scriptSource =
      process.env.NODE_ENV === 'production'
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Legacy browser XSS auditors caused their own security problems; CSP is authoritative.
          { key: 'X-XSS-Protection', value: '0' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSource,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: https://api.dicebear.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "manifest-src 'self'",
              "object-src 'none'",
              "form-action 'self'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const webpack = require('webpack');
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.IgnorePlugin({
          checkResource(resource: string) {
            if (resource === 'twilio') {
              try {
                require.resolve('twilio');
                return false;
              } catch {
                return true;
              }
            }
            return false;
          },
        })
      );
    }

    return config;
  },
};

export default withPWA(nextConfig);
