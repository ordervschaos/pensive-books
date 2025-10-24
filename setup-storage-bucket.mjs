#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qiqeyirtpstdjkkeyfss.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDI4ODYzMSwiZXhwIjoyMDU1ODY0NjMxfQ.bOGNPVWFKhqv9uJw3V6UDyIzDGjx_ayiAV5edR_ioiQ';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('🗂️  Setting up storage bucket for profile pictures...\n');

async function setupBucket() {
  try {
    // Check if bucket exists
    console.log('1️⃣  Checking if profile-pictures bucket exists...');
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      console.log('   Error listing buckets:', listError.message);
    } else {
      const bucketExists = buckets.some(b => b.name === 'profile-pictures');

      if (bucketExists) {
        console.log('   ✓ Bucket already exists');
      } else {
        console.log('   Bucket does not exist, creating...');

        // Create bucket
        const { data: newBucket, error: createError } = await supabase.storage.createBucket('profile-pictures', {
          public: true,
          fileSizeLimit: 5242880, // 5MB
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
        });

        if (createError) {
          console.log('   ❌ Error creating bucket:', createError.message);
          console.log('\n📝 Please create manually in Supabase Dashboard:');
          console.log('   1. Go to Storage section');
          console.log('   2. Click "New bucket"');
          console.log('   3. Name: profile-pictures');
          console.log('   4. Make it Public ✓');
          console.log('   5. Click Create');
          return false;
        } else {
          console.log('   ✓ Bucket created successfully');
        }
      }
    }

    console.log('\n2️⃣  Storage bucket is ready!');
    console.log('\n✅ Setup complete!');
    console.log('\nYou can now:');
    console.log('  • Navigate to /profile/edit');
    console.log('  • Upload your profile picture');
    console.log('  • Add your introduction');
    console.log('  • View your profile at /anzalansari');

    return true;

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.log('\nPlease set up manually in Supabase Dashboard:');
    console.log('1. Go to: https://supabase.com/dashboard/project/qiqeyirtpstdjkkeyfss/storage/buckets');
    console.log('2. Click "New bucket"');
    console.log('3. Name: profile-pictures');
    console.log('4. Toggle "Public bucket" ON');
    console.log('5. Click "Create bucket"');
    return false;
  }
}

setupBucket();
