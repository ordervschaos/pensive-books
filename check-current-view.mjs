#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qiqeyirtpstdjkkeyfss.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDI4ODYzMSwiZXhwIjoyMDU1ODY0NjMxfQ.bOGNPVWFKhqv9uJw3V6UDyIzDGjx_ayiAV5edR_ioiQ';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking current database state...\n');

async function check() {
  // Check what columns exist in user_data
  console.log('1️⃣  Checking user_data table columns...');
  const { data: userData, error: userError } = await supabase
    .from('user_data')
    .select('*')
    .limit(1);

  if (userError) {
    console.log('   Error querying user_data:', userError.message);
  } else if (userData && userData.length > 0) {
    const columns = Object.keys(userData[0]);
    console.log('   Columns:', columns.join(', '));
    console.log('   Has profile_pic?', columns.includes('profile_pic') ? '✓ YES' : '✗ NO');
    console.log('   Has intro?', columns.includes('intro') ? '✓ YES' : '✗ NO');
  }

  // Check what columns exist in the view
  console.log('\n2️⃣  Checking public_user_profiles view...');
  const { data: viewData, error: viewError } = await supabase
    .from('public_user_profiles')
    .select('*')
    .limit(1);

  if (viewError) {
    console.log('   Error:', viewError.message);
  } else if (viewData && viewData.length > 0) {
    const columns = Object.keys(viewData[0]);
    console.log('   Columns:', columns.join(', '));
  } else {
    console.log('   View exists but has no data');
  }

  console.log('\n📝 Next steps:');
  console.log('If profile_pic and intro are NOT in user_data, the ALTER TABLE didn\'t run.');
  console.log('If they ARE in user_data but NOT in the view, the view needs to be recreated.');
}

check();
