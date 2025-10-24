#!/usr/bin/env node

const supabaseUrl = 'https://qiqeyirtpstdjkkeyfss.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDI4ODYzMSwiZXhwIjoyMDU1ODY0NjMxfQ.bOGNPVWFKhqv9uJw3V6UDyIzDGjx_ayiAV5edR_ioiQ';

console.log('🔄 Applying database migration via REST API...\n');

const migrationSQL = `
-- Add profile_pic and intro fields to user_data table
ALTER TABLE user_data
ADD COLUMN IF NOT EXISTS profile_pic TEXT,
ADD COLUMN IF NOT EXISTS intro TEXT;

-- Update public_user_profiles view to include new fields
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

-- Grant select permission on the view
GRANT SELECT ON public_user_profiles TO authenticated, anon;
`;

async function runMigration() {
  try {
    console.log('SQL to execute:');
    console.log(migrationSQL);
    console.log('\n📤 Sending to Supabase...\n');

    // Use the Postgres REST API endpoint
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: migrationSQL })
    });

    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('Response:', text);

    if (response.ok) {
      console.log('\n✅ Migration completed successfully!');
    } else {
      console.log('\n⚠️  API call did not succeed. Running manual instructions...\n');
      console.log('📝 Please run this SQL manually in Supabase Dashboard:\n');
      console.log('1. Go to: https://supabase.com/dashboard/project/qiqeyirtpstdjkkeyfss/editor');
      console.log('2. Click on SQL Editor');
      console.log('3. Copy and paste this SQL:\n');
      console.log('```sql');
      console.log(migrationSQL);
      console.log('```');
      console.log('\n4. Click "Run" or press Cmd/Ctrl + Enter');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.log('\n📝 Please run this SQL manually in Supabase Dashboard:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/qiqeyirtpstdjkkeyfss/editor');
    console.log('2. Click on SQL Editor');
    console.log('3. Copy and paste this SQL:\n');
    console.log('```sql');
    console.log(migrationSQL);
    console.log('```');
    console.log('\n4. Click "Run" or press Cmd/Ctrl + Enter');
  }
}

runMigration();
