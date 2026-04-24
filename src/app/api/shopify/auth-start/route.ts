import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/** Only allow legitimate Shopify domains */
const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * POST /api/shopify/auth-start
 * Stores OAuth credentials server-side and returns the Shopify authorize URL.
 * This keeps client_secret out of the browser entirely.
 * 
 * Body: { clientId, clientSecret, shop }
 * Returns: { authorizeUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const { clientId, clientSecret, shop } = await request.json();

    if (!clientId || !clientSecret || !shop) {
      return NextResponse.json(
        { error: 'Missing clientId, clientSecret, or shop.' },
        { status: 400 }
      );
    }

    // Validate shop domain to prevent SSRF
    if (!SHOPIFY_DOMAIN_REGEX.test(shop)) {
      return NextResponse.json(
        { error: 'Invalid shop domain. Must be *.myshopify.com' },
        { status: 400 }
      );
    }

    // Store credentials server-side (in business_profiles, temporary)
    const { error } = await supabaseAdmin
      .from('business_profiles')
      .update({
        shopify_oauth_state: {
          clientId,
          clientSecret,
          shop,
          createdAt: new Date().toISOString(),
        },
      })
      .eq('id', 1);

    if (error) {
      // If id=1 doesn't work, try updating the first row
      await supabaseAdmin
        .from('business_profiles')
        .update({
          shopify_oauth_state: {
            clientId,
            clientSecret,
            shop,
            createdAt: new Date().toISOString(),
          },
        })
        .limit(1);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const redirectUri = `${appUrl}/shopify-auth`;

    const authorizeUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=read_orders,read_products,read_customers&redirect_uri=${encodeURIComponent(redirectUri)}`;

    return NextResponse.json({ authorizeUrl });
  } catch {
    return NextResponse.json(
      { error: 'Failed to start OAuth flow.' },
      { status: 500 }
    );
  }
}

