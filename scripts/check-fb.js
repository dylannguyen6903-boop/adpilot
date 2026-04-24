const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from('business_profiles')
    .select('fb_accounts, fb_access_token, fb_ad_account_id')
    .limit(1)
    .single();

  if (error) {
    console.error("Error fetching data:", error);
  } else {
    console.log("DB Data:", JSON.stringify(data, null, 2));
  }
}

main();
