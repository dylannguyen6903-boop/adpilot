import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshShopifyAccessToken } from '@/lib/shopify';

/**
 * POST /api/shopify/refresh
 * Manually trigger a Shopify access token refresh.
 * Used as fallback when automatic refresh fails.
 * 
 * Can also accept initial bootstrap credentials:
 * Body: { clientId, clientSecret, refreshToken, shop }
 */
export async function POST(request: Request) {
  try {
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let refreshToken: string | undefined;
    let shop: string | undefined;

    // Try to read from request body (for bootstrapping)
    try {
      const body = await request.json();
      clientId = body.clientId;
      clientSecret = body.clientSecret;
      refreshToken = body.refreshToken;
      shop = body.shop;
    } catch {
      // No body — use DB credentials
    }

    // Fall back to DB credentials
    if (!clientId || !clientSecret || !refreshToken || !shop) {
      const { data: profile } = await supabaseAdmin
        .from('business_profiles')
        .select('shopify_client_id, shopify_client_secret, shopify_refresh_token, shopify_store_domain')
        .limit(1)
        .single();

      if (!profile) {
        return NextResponse.json(
          { error: 'No Shopify credentials found in database.' },
          { status: 400 }
        );
      }

      clientId = clientId || profile.shopify_client_id;
      clientSecret = clientSecret || profile.shopify_client_secret;
      refreshToken = refreshToken || profile.shopify_refresh_token;
      shop = shop || profile.shopify_store_domain;
    }

    if (!clientId || !clientSecret || !refreshToken || !shop) {
      return NextResponse.json(
        { error: 'Missing required credentials: clientId, clientSecret, refreshToken, shop.' },
        { status: 400 }
      );
    }

    // Perform the refresh
    const result = await refreshShopifyAccessToken({
      clientId,
      clientSecret,
      refreshToken,
      shop,
    });

    // Persist new tokens to DB
    const now = new Date();
    const updates: Record<string, unknown> = {
      shopify_access_token: result.access_token,
      shopify_refresh_token: result.refresh_token,
      shopify_store_domain: shop,
      shopify_client_id: clientId,
      shopify_client_secret: clientSecret,
      shopify_token_expires_at: new Date(
        now.getTime() + result.expires_in * 1000
      ).toISOString(),
      updated_at: now.toISOString(),
    };

    if (result.refresh_token_expires_in) {
      updates.shopify_refresh_token_expires_at = new Date(
        now.getTime() + result.refresh_token_expires_in * 1000
      ).toISOString();
    }

    const { error: dbError } = await supabaseAdmin
      .from('business_profiles')
      .update(updates)
      .limit(1);

    if (dbError) {
      console.error('[Shopify Refresh] DB update failed:', dbError);
    }

    return NextResponse.json({
      success: true,
      message: 'Token refreshed successfully.',
      accessTokenPrefix: result.access_token.substring(0, 15) + '...',
      expiresIn: result.expires_in,
      expiresAt: updates.shopify_token_expires_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Token refresh failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
