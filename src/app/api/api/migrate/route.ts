import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/migrate
 * Run V2.0 schema migration: add new columns for fb_status, AI config, etc.
 * This is a one-time endpoint — safe to call multiple times (IF NOT EXISTS).
 */
export async function POST() {
  const results: { step: string; status: string; error?: string }[] = [];

  // 1. Add fb_status to campaign_snapshots
  const { error: e1 } = await supabaseAdmin.rpc('exec_sql', {
    sql: "ALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS fb_status TEXT DEFAULT 'ACTIVE'"
  }).single();
  // Fallback: try direct column check via a dummy select
  if (e1) {
    // Column might already exist or RPC not available — try inserting a test value
    results.push({ step: 'fb_status via RPC', status: 'skipped', error: e1.message });
  } else {
    results.push({ step: 'fb_status', status: 'ok' });
  }

  // Since Supabase doesn't support raw SQL via REST, we'll just verify columns exist 
  // by attempting to query them. If they don't exist, we'll need the Dashboard SQL editor.
  
  // Test if new columns are readable
  const { data: testSnap, error: testErr } = await supabaseAdmin
    .from('campaign_snapshots')
    .select('fb_status, effective_status, campaign_created_time')
    .limit(1);

  if (testErr) {
    results.push({ 
      step: 'column_check', 
      status: 'NEEDS_MANUAL_MIGRATION',
      error: `Columns not found. Please run this SQL in Supabase Dashboard > SQL Editor:\n\nALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS fb_status TEXT DEFAULT 'ACTIVE';\nALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS effective_status TEXT DEFAULT 'ACTIVE';\nALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS campaign_created_time TIMESTAMPTZ;\nALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS ai_api_key TEXT;\nALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai';\nALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gpt-4o-mini';`
    });
  } else {
    results.push({ step: 'column_check', status: 'ok — columns exist' });
  }

  // Test business_profiles AI columns
  const { error: testBp } = await supabaseAdmin
    .from('business_profiles')
    .select('ai_api_key, ai_provider, ai_model')
    .limit(1);

  if (testBp) {
    results.push({ step: 'business_profiles_ai_columns', status: 'NEEDS_MIGRATION', error: testBp.message });
  } else {
    results.push({ step: 'business_profiles_ai_columns', status: 'ok' });
  }

  const allOk = results.every(r => r.status.startsWith('ok'));

  return NextResponse.json({
    success: allOk,
    message: allOk ? 'All V2.0 columns verified.' : 'Some columns need manual migration. See details.',
    results,
  });
}
