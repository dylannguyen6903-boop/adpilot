import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday, getAdAccountDateMinusDays } from '@/lib/timezone';

/**
 * GET /api/shopify/analytics
 * Returns Shopify revenue/order analytics from cached DB data.
 * Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || getAdAccountDateMinusDays(30);
    const to = searchParams.get('to') || getAdAccountToday();

    const { data, error } = await supabaseAdmin
      .from('daily_financials')
      .select('*')
      .gte('report_date', from)
      .lte('report_date', to)
      .order('report_date', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    // Compute summary
    const days = data || [];
    const totalRevenue = days.reduce((sum, d) => sum + (d.shopify_revenue || 0), 0);
    const totalOrders = days.reduce((sum, d) => sum + (d.shopify_orders || 0), 0);
    const avgAov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return NextResponse.json({
      success: true,
      from,
      to,
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        avgAov: Math.round(avgAov * 100) / 100,
        daysWithData: days.length,
      },
      daily: days,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load analytics.' },
      { status: 500 }
    );
  }
}

