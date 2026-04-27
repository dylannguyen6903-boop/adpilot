import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ── In-memory IP rate limiter ──────────────────────────────────
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

// ── Cookie helpers ─────────────────────────────────────────────
function signCookie(payload: string, secret: string): string {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Quá nhiều lần thử. Vui lòng đợi 10 phút.' },
      { status: 429 }
    );
  }

  // Parse body
  let password: string;
  try {
    const body = await request.json();
    password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  // Compare hash — timing-safe
  const expectedHash = process.env.APP_PASSWORD_HASH;
  const secret = process.env.AUTH_SECRET;

  if (!expectedHash || !secret) {
    return NextResponse.json(
      { error: 'Server auth not configured' },
      { status: 500 }
    );
  }

  const inputHash = crypto.createHash('sha256').update(password).digest('hex');

  const a = Buffer.from(inputHash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json(
      { error: 'Sai mật khẩu' },
      { status: 401 }
    );
  }

  // ── Success: set HMAC-signed cookie ──────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 14 * 24 * 60 * 60; // 14 days
  const payload = Buffer.from(JSON.stringify({ iat: now, exp })).toString('base64url');
  const cookieValue = signCookie(payload, secret);

  const response = NextResponse.json({ success: true });

  response.cookies.set('adpilot-auth', cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 14 * 24 * 60 * 60, // 14 days
  });

  return response;
}
