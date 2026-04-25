import { NextResponse } from 'next/server';

/**
 * Next.js Edge Proxy (v16 convention)
 * 
 * Currently pass-through — no auth required.
 * AdPilot is an internal tool, not exposed publicly.
 * Re-enable auth if the app becomes multi-tenant.
 */
export default function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
