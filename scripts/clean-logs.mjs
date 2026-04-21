import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vtgsziordglvxbxudsfr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Z3N6aW9yZGdsdnhieHVkc2ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5NDAwNSwiZXhwIjoyMDkyMTcwMDA1fQ.GJbWMfOd4GBlF0IQUI6HfO3zCpOi4vwe3c3maDpHQFw'
);

async function cleanLogs() {
  // Delete the stale FAILED log
  const { data, error } = await supabase
    .from('sync_logs')
    .delete()
    .eq('sync_type', 'SHOPIFY')
    .eq('status', 'FAILED');

  console.log('Deleted FAILED Shopify logs:', data, error);

  // Verify
  const { data: remaining } = await supabase
    .from('sync_logs')
    .select('*')
    .eq('sync_type', 'SHOPIFY')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('Remaining Shopify logs:', JSON.stringify(remaining, null, 2));
}

cleanLogs();
