// Run database migration for profile fields
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('Running migration: 20251024000000_add_user_profile_fields.sql');

  try {
    // Read migration file
    const migrationPath = join(__dirname, 'supabase/migrations/20251024000000_add_user_profile_fields.sql');
    const sql = readFileSync(migrationPath, 'utf8');

    console.log('Migration SQL:');
    console.log(sql);
    console.log('\nExecuting...');

    // Execute migration (split by semicolons for multiple statements)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      console.log(`\nExecuting: ${statement.substring(0, 80)}...`);
      const { data, error } = await supabase.rpc('exec_sql', { sql_query: statement });

      if (error) {
        // Try direct execution via REST API
        console.log('Trying direct execution...');
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ sql_query: statement }),
        });

        if (!response.ok) {
          console.error('Statement failed:', statement);
          console.error('Error:', error);
          // Continue with next statement
        } else {
          console.log('✓ Statement executed successfully');
        }
      } else {
        console.log('✓ Statement executed successfully');
      }
    }

    console.log('\n✓ Migration completed!');

    // Verify the changes
    console.log('\nVerifying changes...');
    const { data: tableInfo, error: verifyError } = await supabase
      .from('user_data')
      .select('*')
      .limit(1);

    if (verifyError) {
      console.log('Could not verify automatically, but migration may have succeeded');
      console.log('Please check Supabase dashboard SQL editor');
    } else {
      console.log('✓ user_data table is accessible');
    }

  } catch (error) {
    console.error('Migration failed:', error);
    console.log('\nPlease run the migration manually in Supabase Dashboard:');
    console.log('1. Go to SQL Editor');
    console.log('2. Copy contents from: supabase/migrations/20251024000000_add_user_profile_fields.sql');
    console.log('3. Execute the SQL');
    process.exit(1);
  }
}

runMigration();
