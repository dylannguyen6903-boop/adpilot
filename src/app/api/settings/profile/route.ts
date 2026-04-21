import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/profile
 * Returns the current business profile settings.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('business_profiles')
      .select('*')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      profile: data || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch profile: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/profile
 * Updates the business profile settings.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Check if profile exists
    const { data: existing } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .limit(1)
      .single();

    let result;

    if (existing) {
      // Update existing profile
      result = await supabaseAdmin
        .from('business_profiles')
        .update({
          store_name: body.storeName,
          store_url: body.storeUrl,
          target_margin_min: body.targetMarginMin,
          target_margin_max: body.targetMarginMax,
          avg_cogs_rate: body.avgCogsRate,
          target_cpa: body.targetCpa,
          aov: body.aov,
          returning_rate: body.returningRate,
          avg_repeat_orders: body.avgRepeatOrders,
          threshold_winner: body.thresholdWinner,
          threshold_promising: body.thresholdPromising,
          threshold_watch: body.thresholdWatch,
          ...(body.aiProvider !== undefined && { ai_provider: body.aiProvider }),
          ...(body.aiApiKey !== undefined && { ai_api_key: body.aiApiKey }),
          ...(body.aiModel !== undefined && { ai_model: body.aiModel }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      // Create new profile
      result = await supabaseAdmin
        .from('business_profiles')
        .insert({
          store_name: body.storeName || 'Frenzidea',
          store_url: body.storeUrl,
          target_margin_min: body.targetMarginMin ?? 0.17,
          target_margin_max: body.targetMarginMax ?? 0.20,
          avg_cogs_rate: body.avgCogsRate ?? 0.80,
          target_cpa: body.targetCpa ?? 40,
          aov: body.aov ?? 87,
          returning_rate: body.returningRate ?? 0.22,
          avg_repeat_orders: body.avgRepeatOrders ?? 1.5,
          threshold_winner: body.thresholdWinner ?? 0.7,
          threshold_promising: body.thresholdPromising ?? 0.4,
          threshold_watch: body.thresholdWatch ?? 0.2,
          ai_provider: body.aiProvider || 'openai',
          ai_api_key: body.aiApiKey || null,
          ai_model: body.aiModel || 'gpt-4o-mini',
        })
        .select()
        .single();
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      profile: result.data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to save profile: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
