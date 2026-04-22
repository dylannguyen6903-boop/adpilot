import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday } from '@/lib/timezone';

export const maxDuration = 60;

const CHAT_SYSTEM_PROMPT = `You are a senior Facebook Ads strategist for a Print-on-Demand (POD) business. You speak Vietnamese.

You analyze campaign data and provide actionable, data-driven advice. Be direct and concise.

Rules:
- Reference specific numbers (CPA, spend, ROAS, conversions).
- Be conservative with budget increases, aggressive with cuts.
- Always explain WHY before suggesting WHAT to do.
- Use Vietnamese for all responses.
- Keep responses under 300 words.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * POST /api/engine/chat
 * AI chat endpoint for discussing campaign strategy.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [] } = body as { message: string; history: ChatMessage[] };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // 1. Load AI config
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('ai_api_key, ai_provider, ai_model, aov, avg_cogs_rate, target_cpa, monthly_profit_target')
      .limit(1)
      .single();

    if (!profile?.ai_api_key) {
      return NextResponse.json({
        reply: '⚠️ Chưa cấu hình AI API Key. Vào Settings → Cấu hình AI để thêm.',
        tokens: 0,
      });
    }

    // 2. Get compact campaign context (top 30 by spend today)
    const today = getAdAccountToday();
    const { data: campaigns } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_name, spend, conversions, daily_budget, fb_status')
      .eq('snapshot_date', today)
      .gt('spend', 0)
      .order('spend', { ascending: false })
      .limit(30);

    const { data: todayFin } = await supabaseAdmin
      .from('daily_financials')
      .select('shopify_revenue')
      .eq('report_date', today)
      .single();

    // 3. Build context
    const cogsRate = profile.avg_cogs_rate ?? 0.20;
    const totalSpend = campaigns?.reduce((s: number, c: { spend: number }) => s + c.spend, 0) ?? 0;
    const totalConv = campaigns?.reduce((s: number, c: { conversions: number }) => s + c.conversions, 0) ?? 0;
    const revenue = todayFin?.shopify_revenue ?? 0;
    const profit = revenue * (1 - cogsRate) - totalSpend;

    const campSummary = campaigns?.map((c: {
      campaign_name: string;
      spend: number;
      conversions: number;
      daily_budget: number;
    }) => {
      const cpa = c.conversions > 0 ? (c.spend / c.conversions).toFixed(0) : 'N/A';
      return `• ${c.campaign_name}: spend $${c.spend.toFixed(0)}, ${c.conversions} conv, CPA $${cpa}, budget $${c.daily_budget}`;
    }).join('\n') || 'Không có dữ liệu campaign hôm nay.';

    const contextPrompt = `
BUSINESS CONTEXT:
- AOV: $${profile.aov ?? 86}, COGS: ${((cogsRate) * 100).toFixed(0)}%, Target CPA: $${profile.target_cpa ?? 40}
- Monthly Profit Target: $${(profile.monthly_profit_target ?? 15000).toLocaleString()}
- Today: Revenue $${revenue.toFixed(0)}, Ad Spend $${totalSpend.toFixed(0)}, Orders ${totalConv}, Net Profit $${profit.toFixed(0)}

TOP CAMPAIGNS TODAY:
${campSummary}
`;

    // 4. Build messages for OpenAI
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT + '\n\n' + contextPrompt },
    ];

    // Add history (last 5 pairs max)
    for (const msg of (history as ChatMessage[]).slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }

    messages.push({ role: 'user', content: message });

    // 5. Call OpenAI
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.ai_api_key}`,
      },
      body: JSON.stringify({
        model: profile.ai_model || 'gpt-4o-mini',
        messages,
        temperature: 0.5,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({
        reply: `❌ AI Error: ${(err as { error?: { message?: string } })?.error?.message || res.statusText}`,
        tokens: 0,
      });
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || 'Không có phản hồi.';
    const tokens = data.usage?.total_tokens || 0;

    return NextResponse.json({ reply, tokens });
  } catch (error) {
    return NextResponse.json(
      { reply: `❌ Lỗi: ${error instanceof Error ? error.message : String(error)}`, tokens: 0 },
    );
  }
}
