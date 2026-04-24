import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday } from '@/lib/timezone';

/**
 * GET /api/facebook/insights
 * Returns campaign insights for a date range.
 * Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&campaign_id=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to') || getAdAccountToday();
    const campaignId = searchParams.get('campaign_id');

    if (!from) {
      return NextResponse.json(
        { error: 'Missing "from" date parameter (YYYY-MM-DD).' },
        { status: 400 }
      );
    }

    let query = supabaseAdmin
      .from('campaign_snapshots')
      .select('*')
      .gte('snapshot_date', from)
      .lte('snapshot_date', to)
      .order('snapshot_date', { ascending: true });

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      from,
      to,
      insights: data || [],
      count: data?.length || 0,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load insights.' },
      { status: 500 }
    );
  }
}

