import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requestShopifyClientCredentialsToken } from '@/lib/shopifyToken';

/** Only allow legitimate Shopify domains */
const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * POST /api/shopify/auth-start
 * Gets a Shopify Admin API token with the Dev Dashboard client credentials flow.
 * 
 * Body: { clientId, clientSecret, shop }
 * Returns: { access_token, scope, expires_in }
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

    const token = await requestShopifyClientCredentialsToken({ shop, clientId, clientSecret });

    const { data: existing } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .limit(1)
      .single();

    const updates = {
      shopify_store_domain: shop,
      shopify_access_token: token.accessToken,
      shopify_oauth_state: {
        clientId,
        clientSecret,
        shop,
        tokenFlow: 'client_credentials',
        updatedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };

    const result = existing
      ? await supabaseAdmin.from('business_profiles').update(updates).eq('id', existing.id)
      : await supabaseAdmin.from('business_profiles').insert({ store_name: 'Frenzidea', ...updates });

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({
      access_token: token.accessToken,
      scope: token.scope,
      expires_in: token.expiresIn,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get Shopify access token.' },
      { status: 500 }
    );
  }
}
