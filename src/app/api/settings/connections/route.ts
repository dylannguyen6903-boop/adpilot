import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { validateFacebookToken } from '@/lib/facebook';
import { validateShopifyConnection } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/connections
 * Returns connection status for Facebook and Shopify.
 */
export async function GET() {
  try {
    // Get last sync logs
    const { data: fbLogs } = await supabaseAdmin
      .from('sync_logs')
      .select('*')
      .eq('sync_type', 'FACEBOOK')
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: shopifyLogs } = await supabaseAdmin
      .from('sync_logs')
      .select('*')
      .eq('sync_type', 'SHOPIFY')
      .order('created_at', { ascending: false })
      .limit(1);

    // Get profile for connection info
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('fb_accounts, fb_access_token, fb_ad_account_id, shopify_store_domain, shopify_access_token')
      .limit(1)
      .single();

    let fbAccounts = profile?.fb_accounts || [];
    if (!Array.isArray(fbAccounts)) fbAccounts = [];
    if (fbAccounts.length === 0 && profile?.fb_access_token && profile?.fb_ad_account_id) {
      fbAccounts = [{
        id: 'legacy-1',
        accessToken: profile.fb_access_token,
        adAccountId: profile.fb_ad_account_id,
        name: profile.fb_ad_account_id
      }];
    }

    // Mask access tokens before sending to client
    const maskedAccounts = fbAccounts.map((acc: Record<string, unknown>) => ({
      ...acc,
      accessToken: typeof acc.accessToken === 'string' && (acc.accessToken as string).length > 14
        ? (acc.accessToken as string).substring(0, 10) + '***' + (acc.accessToken as string).substring((acc.accessToken as string).length - 4)
        : '***configured***',
    }));

    return NextResponse.json({
      success: true,
      connections: {
        facebook: {
          configured: fbAccounts.length > 0,
          accounts: maskedAccounts,
          lastSync: fbLogs?.[0]?.created_at || null,
          lastSyncStatus: fbLogs?.[0]?.status || null,
          lastError: fbLogs?.[0]?.error_message || null,
        },
        shopify: {
          configured: !!(profile?.shopify_store_domain && profile?.shopify_access_token),
          storeDomain: profile?.shopify_store_domain || null,
          lastSync: shopifyLogs?.[0]?.created_at || null,
          lastSyncStatus: shopifyLogs?.[0]?.status || null,
          lastError: shopifyLogs?.[0]?.error_message || null,
        },
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load connections.' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/connections
 * Updates API connection credentials.
 * Validates tokens before saving.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const validationResults: Record<string, unknown> = {};

    // Validate and save Facebook credentials (multi-account)
    if (body.fbAccounts !== undefined && Array.isArray(body.fbAccounts)) {
      // Fetch existing accounts from DB to distinguish NEW tokens from existing ones
      const { data: currentProfile } = await supabaseAdmin
        .from('business_profiles')
        .select('fb_accounts')
        .limit(1)
        .single();
      const existingTokens = new Set(
        (Array.isArray(currentProfile?.fb_accounts) ? currentProfile.fb_accounts : [])
          .map((a: { accessToken?: string }) => a.accessToken)
          .filter(Boolean)
      );

      validationResults.facebook = [];
      const invalidNewAccounts: string[] = [];

      for (const account of body.fbAccounts) {
        if (account.accessToken) {
          const isNewToken = !existingTokens.has(account.accessToken);

          if (isNewToken) {
            // Only validate genuinely NEW tokens — don't re-validate existing ones
            const fbValidation = await validateFacebookToken(account.accessToken);
            (validationResults.facebook as any[]).push({
              ...account, valid: fbValidation.valid, error: fbValidation.error, isNew: true,
            });

            if (!fbValidation.valid) {
              invalidNewAccounts.push(
                `${account.name || account.adAccountId}: ${fbValidation.error}`
              );
            }
          } else {
            // Existing token — skip validation, allow removals/reorders
            (validationResults.facebook as any[]).push({
              ...account, valid: true, isNew: false,
            });
          }
        }
      }

      // Reject if ANY new token is invalid — don't save garbage credentials
      if (invalidNewAccounts.length > 0) {
        return NextResponse.json(
          {
            error: `Token Facebook không hợp lệ: ${invalidNewAccounts.join('; ')}`,
            validationResults,
          },
          { status: 400 }
        );
      }

      updates.fb_accounts = body.fbAccounts;
    }

    // Legacy backwards compatibility (optional support)
    if (body.fbAccessToken !== undefined) updates.fb_access_token = body.fbAccessToken || null;
    if (body.fbAdAccountId !== undefined) updates.fb_ad_account_id = body.fbAdAccountId || null;

    // Validate and save Shopify credentials
    if (body.shopifyStoreDomain !== undefined && body.shopifyAccessToken !== undefined) {
      if (body.shopifyStoreDomain && body.shopifyAccessToken) {
        const shopifyValidation = await validateShopifyConnection({
          storeDomain: body.shopifyStoreDomain,
          accessToken: body.shopifyAccessToken,
        });
        validationResults.shopify = shopifyValidation;

        if (!shopifyValidation.valid) {
          return NextResponse.json(
            { error: `Invalid Shopify credentials: ${shopifyValidation.error}`, validationResults },
            { status: 400 }
          );
        }
      }
      updates.shopify_store_domain = body.shopifyStoreDomain || null;
      updates.shopify_access_token = body.shopifyAccessToken || null;
    }

    if (body.shopifyApiKey !== undefined) {
      updates.shopify_api_key = body.shopifyApiKey || null;
    }
    if (body.shopifyApiSecret !== undefined) {
      updates.shopify_api_secret = body.shopifyApiSecret || null;
    }

    // Upsert profile with connection details
    const { data: existing } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .limit(1)
      .single();

    let result;
    if (existing) {
      result = await supabaseAdmin
        .from('business_profiles')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await supabaseAdmin
        .from('business_profiles')
        .insert({ store_name: 'Frenzidea', ...updates })
        .select()
        .single();
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      validationResults,
      message: 'Connections updated successfully.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save connections.' },
      { status: 500 }
    );
  }
}
