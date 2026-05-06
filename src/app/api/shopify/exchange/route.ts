import { NextRequest, NextResponse } from 'next/server';

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

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'OAuth exchange failed.' }, { status: 500 });
  }
}
