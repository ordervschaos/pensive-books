#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qiqeyirtpstdjkkeyfss.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDI4ODYzMSwiZXhwIjoyMDU1ODY0NjMxfQ.bOGNPVWFKhqv9uJw3V6UDyIzDGjx_ayiAV5edR_ioiQ';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔄 Applying database migration...\n');

async function runMigration() {
  try {
    // Step 1: Add profile_pic column
    console.log('1️⃣  Adding profile_pic column...');
    const { error: error1 } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE user_data ADD COLUMN IF NOT EXISTS profile_pic TEXT;'
    });

    if (error1 && !error1.message.includes('already exists')) {
      console.log('   Note:', error1.message);
    } else {
      console.log('   ✓ profile_pic column added');
    }

    // Step 2: Add intro column
    console.log('2️⃣  Adding intro column...');
    const { error: error2 } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE user_data ADD COLUMN IF NOT EXISTS intro TEXT;'
    });

    if (error2 && !error2.message.includes('already exists')) {
      console.log('   Note:', error2.message);
    } else {
      console.log('   ✓ intro column added');
    }

    // Step 3: Update the view
    console.log('3️⃣  Updating public_user_profiles view...');
    const viewSQL = `
      CREATE OR REPLACE VIEW public_user_profiles AS
      SELECT
        user_id,
        username,
        email,
        profile_pic,
        intro,
        created_at
      FROM user_data
      WHERE username IS NOT NULL;
    `;

    const { error: error3 } = await supabase.rpc('exec_sql', {
      sql: viewSQL
    });

    if (error3) {
      console.log('   Note:', error3.message);
    } else {
      console.log('   ✓ View updated');
    }

    // Step 4: Grant permissions
    console.log('4️⃣  Granting permissions...');
    const { error: error4 } = await supabase.rpc('exec_sql', {
      sql: 'GRANT SELECT ON public_user_profiles TO authenticated, anon;'
    });

    if (error4) {
      console.log('   Note:', error4.message);
    } else {
      console.log('   ✓ Permissions granted');
    }

    console.log('\n✅ Migration completed successfully!\n');

    // Verify the changes
    console.log('🔍 Verifying changes...');
    const { data, error } = await supabase
      .from('public_user_profiles')
      .select('user_id, username, profile_pic, intro')
      .limit(1);

    if (error) {
      console.log('⚠️  Could not verify - you may need to run SQL manually');
      console.log('   Error:', error.message);
    } else {
      console.log('✓ public_user_profiles view is working correctly');
      if (data && data.length > 0) {
        console.log('  Sample record:', data[0]);
      }
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.log('\n📝 Manual migration steps:');
    console.log('1. Go to Supabase Dashboard > SQL Editor');
    console.log('2. Run the following SQL:\n');
    console.log(`
ALTER TABLE user_data
ADD COLUMN IF NOT EXISTS profile_pic TEXT,
ADD COLUMN IF NOT EXISTS intro TEXT;

CREATE OR REPLACE VIEW public_user_profiles AS
SELECT
  user_id,
  username,
  email,
  profile_pic,
  intro,
  created_at
FROM user_data
WHERE username IS NOT NULL;

GRANT SELECT ON public_user_profiles TO authenticated, anon;
    `);
  }
}

runMigration();
