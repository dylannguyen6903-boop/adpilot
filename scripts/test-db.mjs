import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  // Check business profile for AI config
  const { data: profile } = await supabase.from('business_profiles').select('*').limit(1).single();
  console.log('=== BUSINESS PROFILE ===');
  console.log('AI Provider:', profile?.ai_provider || 'NOT SET');
  console.log('AI Model:', profile?.ai_model || 'NOT SET');
  console.log('AI API Key:', profile?.ai_api_key ? `SET (${profile.ai_api_key.substring(0,8)}...)` : 'NOT SET');
  console.log('Target CPA:', profile?.target_cpa);
  console.log('COGS Rate:', profile?.avg_cogs_rate);
  console.log('Target Margin:', profile?.target_margin_min, '-', profile?.target_margin_max);
  console.log('AOV:', profile?.aov);

  // Check what Plan API would return for today
  const today = new Date(Date.now() - 7 * 3600000).toISOString().split('T')[0]; // GMT-7
  const { data: todaySnaps, count } = await supabase
    .from('campaign_snapshots')
    .select('spend', { count: 'exact' })
    .eq('snapshot_date', today)
    .gt('spend', 0);
  const totalSpend = todaySnaps ? todaySnaps.reduce((s, r) => s + r.spend, 0) : 0;
  console.log(`\n=== TODAY (${today} in GMT-7) ===`);
  console.log(`Campaigns with spend > 0: ${count}`);
  console.log(`Total FB Spend: $${totalSpend.toFixed(2)}`);

  // Check daily_financials for today
  const { data: fin } = await supabase.from('daily_financials').select('*').eq('report_date', today).single();
  console.log(`Shopify Revenue: $${fin?.shopify_revenue || 0}`);
  console.log(`Net Profit = $${fin?.shopify_revenue || 0} - $${((fin?.shopify_revenue || 0) * (profile?.avg_cogs_rate || 0.8)).toFixed(2)} (COGS) - $${totalSpend.toFixed(2)} (Ad Spend)`);
  const netProfit = (fin?.shopify_revenue || 0) - (fin?.shopify_revenue || 0) * (profile?.avg_cogs_rate || 0.8) - totalSpend;
  console.log(`= $${netProfit.toFixed(2)}`);

  // Check action_plans
  const { data: plans } = await supabase.from('action_plans').select('*').order('plan_date', { ascending: false }).limit(3);
  console.log('\n=== RECENT ACTION PLANS ===');
  console.log(JSON.stringify(plans?.map(p => ({ date: p.plan_date, ai_used: p.ai_used, actions_count: p.actions?.length })), null, 2));
}
run();
