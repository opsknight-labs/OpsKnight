import path from 'path';

import type { NextConfig } from 'next';

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  // Disable in dev to avoid caching issues; allow explicit override.
  disable: process.env.NODE_ENV === 'development' || process.env.DISABLE_PWA === 'true',
  register: true,
  skipWaiting: true,
  sw: 'sw.js', // Use auto-generated SW but we'll add push handlers via workbox
  workboxOptions: {
    disableDevLogs: true,
    additionalManifestEntries: [],
    importScripts: ['/custom-sw.js'],
    // Explicit runtime caching rules:
    // Dynamic pages, RSC streams, and APIs MUST ALWAYS be NetworkOnly.
    // Caching HTML or RSC payloads in a Service Worker poisons session
    // states and causes login deadlocks when credentials change or sessions expire.
    runtimeCaching: [
      // 1. ALL API routes must ALWAYS bypass Service Worker cache
      {
        urlPattern: /^\/api\/.*/i,
        handler: 'NetworkOnly',
        options: {
          cacheName: 'no-cache-apis',
        },
      },
      // 2. RSC payloads & Next.js router prefetch streams must ALWAYS bypass cache
      {
        urlPattern: ({ request, url }: { request: Request; url: URL }) =>
          request.headers.get('RSC') === '1' ||
          url.searchParams.has('_rsc') ||
          request.headers.get('Next-Router-Prefetch') === '1',
        handler: 'NetworkOnly',
        options: {
          cacheName: 'no-cache-rsc',
        },
      },
      // 3. Dynamic auth, app, and settings page documents must ALWAYS bypass cache
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
        options: {
          cacheName: 'no-cache-pages',
        },
      },
      // 4. Google fonts webfonts (immutable)
      {
        urlPattern: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-webfonts',
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 365 days
          },
        },
      },
      // 5. Google fonts stylesheets
      {
        urlPattern: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'google-fonts-stylesheets',
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          },
        },
      },
      // 6. Next.js immutable static JS/CSS chunks (hashed names)
      {
        urlPattern: /\/_next\/static\/.+\.(?:js|css)$/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'next-static-assets',
          expiration: {
            maxEntries: 500,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          },
        },
      },
      // 7. Static images
      {
        urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-images',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          },
        },
      },
    ],
  },
  // DO NOT inherit next-pwa's default runtime caching rules: they blindly cache
  // pages-rsc and HTML documents in NetworkFirst, which caches 307 auth redirects.
  extendDefaultRuntimeCaching: false,
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  swcMinify: true,
  fallbacks: {},
  // Never precache the dynamic root document as start_url
  cacheStartUrl: false,
  dynamicStartUrl: false,
});

const nextConfig: NextConfig = {
  // Allow overriding distDir for concurrent builds (e.g. pre-push checks)
  distDir: process.env.BUILD_DIR || '.next',
  output: 'standalone',
  // Explicitly set root to avoid system-wide watching
  outputFileTracingRoot: path.join(__dirname),
  // Performance optimizations
  experimental: {
    optimizePackageImports: ['@prisma/client', 'react-icons'],
    // Allow larger file uploads via Server Actions (default is 1MB)
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Turbopack: explicitly configure to allow custom webpack config
  turbopack: {},
  // Compiler optimizations
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },
  // Security headers
  images: {
    localPatterns: [
      {
        pathname: '/api/avatar',
        search: '?**',
      },
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            // Content Security Policy configuration
            // Note on 'unsafe-eval' and 'unsafe-inline':
            // - 'unsafe-eval' is required by Next.js for development hot reloading
            // - 'unsafe-inline' is required for styled-jsx and inline styles used by React
            // - In a stricter environment, consider using nonce-based CSP with next-safe
            // - See: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
            value: [
              "default-src 'self'",
              // Script sources: self + eval/inline for Next.js compatibility
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              // Style sources: self + inline for CSS-in-JS + Google Fonts
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Image sources: self + data URIs + HTTPS (for avatars, external images)
              "img-src 'self' data: https: https://api.dicebear.com",
              // Font sources: self + data URIs + Google Fonts
              "font-src 'self' data: https://fonts.gstatic.com",
              // Connect sources: self only (API calls, WebSocket for dev)
              "connect-src 'self'",
              // Prevent embedding in frames (clickjacking protection)
              "frame-ancestors 'none'",
              // PWA manifest
              "manifest-src 'self'",
              // Block all objects (Flash, etc.)
              "object-src 'none'",
              // Restrict form submissions to self
              "form-action 'self'",
              // Restrict base URI to prevent base-tag hijacking
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  // Bundle optimization
  webpack: (config, { isServer }) => {
    // Make twilio optional - it's only needed if WhatsApp notifications are enabled
    // Use IgnorePlugin to prevent webpack from trying to resolve it at build time
    if (isServer) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const webpack = require('webpack');
      config.plugins = config.plugins || [];
      // Ignore twilio module resolution - it will be loaded dynamically at runtime if needed
      // Use checkResource to conditionally ignore only if the module doesn't exist
      config.plugins.push(
        new webpack.IgnorePlugin({
          checkResource(resource: string) {
            // Only ignore twilio if it's being required
            if (resource === 'twilio') {
              try {
                // Try to resolve it - if it fails, we'll ignore it
                require.resolve('twilio');
                return false; // Don't ignore if it exists
              } catch {
                return true; // Ignore if it doesn't exist
              }
            }
            return false; // Don't ignore other modules
          },
        })
      );
    }

    return config;
  },
};

export default withPWA(nextConfig);
