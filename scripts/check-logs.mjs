import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vtgsziordglvxbxudsfr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Z3N6aW9yZGdsdnhieHVkc2ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5NDAwNSwiZXhwIjoyMDkyMTcwMDA1fQ.GJbWMfOd4GBlF0IQUI6HfO3zCpOi4vwe3c3maDpHQFw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLogs() {
  const { data, error } = await supabase
    .from('sync_logs')
    .select('*')
    .eq('sync_type', 'SHOPIFY')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (error) console.error(error);
  console.log(JSON.stringify(data, null, 2));
}

checkLogs();
