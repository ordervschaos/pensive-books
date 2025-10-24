#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qiqeyirtpstdjkkeyfss.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDI4ODYzMSwiZXhwIjoyMDU1ODY0NjMxfQ.bOGNPVWFKhqv9uJw3V6UDyIzDGjx_ayiAV5edR_ioiQ';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Verifying migration...\n');

async function verify() {
  try {
    // Test 1: Check if we can query the view with new columns
    console.log('1️⃣  Testing public_user_profiles view...');
    const { data, error } = await supabase
      .from('public_user_profiles')
      .select('user_id, username, profile_pic, intro')
      .limit(1);

    if (error) {
      console.log('   ❌ Error:', error.message);
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        console.log('\n⚠️  Migration not yet applied or failed.');
        console.log('Please run the SQL in Supabase Dashboard.');
        return false;
      }
      throw error;
    }

    console.log('   ✓ View is working correctly');
    if (data && data.length > 0) {
      console.log('   Sample data:', {
        username: data[0].username,
        has_profile_pic: data[0].profile_pic !== null,
        has_intro: data[0].intro !== null
      });
    }

    console.log('\n✅ Migration verified successfully!');
    console.log('\nYou can now:');
    console.log('  • Navigate to /profile/edit to set up your profile');
    console.log('  • Upload a profile picture');
    console.log('  • Write your introduction');
    console.log('  • View your publishing page at /:username');

    return true;

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.log('\nPlease check:');
    console.log('  1. Did you run the SQL in Supabase Dashboard?');
    console.log('  2. Did it execute without errors?');
    console.log('  3. Try refreshing the schema in Supabase Dashboard');
    return false;
  }
}

verify();
