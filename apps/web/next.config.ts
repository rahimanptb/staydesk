import type { NextConfig } from 'next';

// In production the reverse proxy (Caddy) routes /api/* straight to the API service;
// in development Next forwards it so the browser always talks to one origin.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// Document-level security headers (docs/10 §5). A nonce-based CSP is added with authentication.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
