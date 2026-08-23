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
    // Add custom runtime caching and handlers
    runtimeCaching: [
      {
        urlPattern:
          /^\/api\/(auth|user|notifications|incidents|admin|settings|teams|schedules|services)\/.*/i,
        handler: 'NetworkOnly',
        options: {
          cacheName: 'no-cache-authenticated-apis',
        },
      },
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
    ],
  },
  // Inject custom push event handlers
  extendDefaultRuntimeCaching: true,
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  swcMinify: true,
  fallbacks: {},
  cacheStartUrl: true,
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

    // Only apply optimizations in production builds
    if (!isServer && process.env.NODE_ENV === 'production') {
      // Optimize client-side bundle
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Vendor chunk for large libraries
            vendor: {
              name: 'vendor',
              chunks: 'all',
              test: /node_modules/,
              priority: 20,
            },
            // Common chunk for shared code
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
            },
          },
        },
      };
    }
    return config;
  },
};

export default withPWA(nextConfig);
