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
        { error: 'Failed to load customer data.' },
        { status: 500 }
      );
    }

    const customers = (data || []).map((c: Record<string, unknown>) => ({
      ...c,
      // Mask email: "john.doe@gmail.com" → "jo***@gmail.com"
      customer_email: typeof c.customer_email === 'string'
        ? maskEmail(c.customer_email as string)
        : null,
    }));

    const totalCustomers = customers.length;
    const returningCount = customers.filter((c: Record<string, unknown>) => c.is_returning).length;
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
  } catch {
    return NextResponse.json(
      { error: 'Failed to load customer data.' },
      { status: 500 }
    );
  }
}

/** Mask email: "john.doe@gmail.com" → "jo***@gmail.com" */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***@***';
  const visible = Math.min(2, local.length);
  return local.substring(0, visible) + '***@' + domain;
}

