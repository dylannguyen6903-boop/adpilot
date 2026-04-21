import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/cron/sync
 * Vercel Cron endpoint — runs every 4 hours.
 * Triggers both Facebook + Shopify sync sequentially.
 * 
 * Protected by CRON_SECRET to prevent unauthorized calls.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret (Vercel sends this automatically)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = {
    facebook: { success: false, error: null as string | null, data: null as Record<string, unknown> | null },
    shopify: { success: false, error: null as string | null, data: null as Record<string, unknown> | null },
  };

  // 1. Sync Facebook
  try {
    const fbRes = await fetch(new URL('/api/facebook/sync', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const fbData = await fbRes.json();
    results.facebook.success = fbRes.ok;
    results.facebook.data = fbData;
    if (!fbRes.ok) results.facebook.error = fbData.error;
  } catch (err) {
    results.facebook.error = String(err);
  }

  // 2. Sync Shopify
  try {
    const shopifyRes = await fetch(new URL('/api/shopify/sync', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const shopifyData = await shopifyRes.json();
    results.shopify.success = shopifyRes.ok;
    results.shopify.data = shopifyData;
    if (!shopifyRes.ok) results.shopify.error = shopifyData.error;
  } catch (err) {
    results.shopify.error = String(err);
  }

  const overallSuccess = results.facebook.success && results.shopify.success;

  return NextResponse.json({
    success: overallSuccess,
    timestamp: new Date().toISOString(),
    results,
  });
}
