import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client for browser/client-side usage.
 * Uses the anon key with Row Level Security enabled.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');
