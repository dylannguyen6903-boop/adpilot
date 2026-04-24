import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Edge Middleware — API Authentication
 * 
 * Protects all /api/* routes from unauthorized access.
 * 
 * Auth methods (in priority order):
 * 1. x-api-key header  — used by frontend & external clients
 * 2. Bearer token       — used by Vercel Cron (CRON_SECRET)
 * 
 * Whitelisted routes (handled by their own auth):
 * - /api/cron/sync — uses CRON_SECRET Bearer auth internally
 */

const PUBLIC_PATHS = [
  '/api/cron/sync',  // Has its own CRON_SECRET auth
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Allow whitelisted paths (they have their own auth)
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check API key
  const apiKey = process.env.ADPILOT_API_KEY;

  // If no API key is configured, skip auth (dev mode / not yet set up)
  if (!apiKey) {
    return NextResponse.next();
  }

  const requestKey = request.headers.get('x-api-key');

  if (requestKey !== apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized. Provide valid x-api-key header.' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
