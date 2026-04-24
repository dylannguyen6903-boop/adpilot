import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/** Only allow legitimate Shopify domains */
const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * POST /api/shopify/exchange
 * Exchanges Shopify OAuth code for access_token.
 * 
 * Reads client credentials from server-side state (DB) — never from browser.
 * Body: { shop, code }
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

    // Try to get credentials from server-side state first
    let clientId = body.clientId;
    let clientSecret = body.clientSecret;

    if (!clientId || !clientSecret) {
      const { data: profile } = await supabaseAdmin
        .from('business_profiles')
        .select('shopify_oauth_state')
        .limit(1)
        .single();

      const oauthState = profile?.shopify_oauth_state;
      if (oauthState?.clientId && oauthState?.clientSecret) {
        clientId = oauthState.clientId;
        clientSecret = oauthState.clientSecret;
      }
    }

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

    // Clean up OAuth state after successful exchange
    if (data.access_token) {
      await supabaseAdmin
        .from('business_profiles')
        .update({ shopify_oauth_state: null })
        .limit(1);
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'OAuth exchange failed.' }, { status: 500 });
  }
}

