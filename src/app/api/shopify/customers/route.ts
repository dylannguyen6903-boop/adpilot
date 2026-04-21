import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/shopify/customers
 * Returns customer LTV data from cached DB.
 * Query params: ?returning_only=true&limit=50
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const returningOnly = searchParams.get('returning_only') === 'true';
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    let query = supabaseAdmin
      .from('customer_ltv')
      .select('*')
      .order('total_revenue', { ascending: false })
      .limit(limit);

    if (returningOnly) {
      query = query.eq('is_returning', true);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    const customers = data || [];
    const totalCustomers = customers.length;
    const returningCount = customers.filter((c) => c.is_returning).length;
    const returningRate = totalCustomers > 0 ? returningCount / totalCustomers : 0;

    return NextResponse.json({
      success: true,
      summary: {
        totalCustomers,
        returningCount,
        returningRate: Math.round(returningRate * 100) / 100,
      },
      customers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch customers: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
