import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vtgsziordglvxbxudsfr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Z3N6aW9yZGdsdnhieHVkc2ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5NDAwNSwiZXhwIjoyMDkyMTcwMDA1fQ.GJbWMfOd4GBlF0IQUI6HfO3zCpOi4vwe3c3maDpHQFw';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('campaign_snapshots')
    .select('campaign_id, campaign_name')
    .eq('campaign_id', '120245072007100253');
    
  if (error) console.error('Error:', error);
  else console.log('Checking 120245072007100253:', data);
}

main();
