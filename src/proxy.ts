import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Next.js 16 Proxy — Password Gate + API Auth
 *
 * 1. Public paths (login, auth API, cron, static) → pass through
 * 2. All other requests → check "adpilot-auth" cookie
 *    - Pages without cookie → redirect /login
 *    - API routes without cookie → 401 JSON
 * 3. API routes also accept x-api-key for backward compat / cron
 */

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/cron/sync', // Has its own CRON_SECRET auth
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  );
}

function verifyCookie(cookieValue: string, secret: string): boolean {
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return false;

  const [payload, sig] = parts;

  // Verify signature
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  // Timing-safe comparison
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  // Check expiry
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    if (data.exp && now > data.exp) return false;
  } catch {
    return false;
  }

  return true;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Static assets — always pass
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // 2. Public paths — always pass
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 3. Check auth cookie
  const secret = process.env.AUTH_SECRET;
  const cookie = request.cookies.get('adpilot-auth')?.value;

  const isAuthenticated = !!(secret && cookie && verifyCookie(cookie, secret));

  if (!isAuthenticated) {
    // API routes → 401 JSON (except if they have a valid API key)
    if (pathname.startsWith('/api')) {
      const apiKey = process.env.ADPILOT_API_KEY;
      const requestKey = request.headers.get('x-api-key');

      // Allow API key auth as fallback (for scripts, cron, etc.)
      if (apiKey && requestKey === apiKey) {
        return NextResponse.next();
      }

      return NextResponse.json(
        { error: 'Unauthorized. Please login first.' },
        { status: 401 }
      );
    }

    // Pages → redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
