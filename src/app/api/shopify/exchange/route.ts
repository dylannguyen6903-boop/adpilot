import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/** Only allow legitimate Shopify domains */
const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * POST /api/shopify/exchange
 * Exchanges Shopify OAuth code for access_token.
 * 
 * Body: { shop, code, clientId, clientSecret }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shop, code } = body;

    if (!shop || !code) {
      return NextResponse.json(
        { error: 'Missing shop or code.' },
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

    const clientId = body.clientId;
    const clientSecret = body.clientSecret;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'OAuth credentials not found. Start the auth flow first.' },
        { status: 400 }
      );
    }

    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const data = await response.json();

    // Persist tokens after successful exchange
    if (data.access_token) {
      const now = new Date();
      const tokenUpdates: Record<string, unknown> = {
        shopify_store_domain: shop,
        shopify_access_token: data.access_token,
        updated_at: now.toISOString(),
      };

      if (data.refresh_token) {
        tokenUpdates.shopify_refresh_token = data.refresh_token;
      }
      if (data.expires_in) {
        tokenUpdates.shopify_token_expires_at = new Date(
          now.getTime() + data.expires_in * 1000
        ).toISOString();
      }
      if (data.refresh_token_expires_in) {
        tokenUpdates.shopify_refresh_token_expires_at = new Date(
          now.getTime() + data.refresh_token_expires_in * 1000
        ).toISOString();
      }
      if (clientId) tokenUpdates.shopify_client_id = clientId;
      if (clientSecret) tokenUpdates.shopify_client_secret = clientSecret;

      await supabaseAdmin
        .from('business_profiles')
        .update(tokenUpdates)
        .limit(1);
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'OAuth exchange failed.' }, { status: 500 });
  }
}

