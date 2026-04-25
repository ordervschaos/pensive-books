# Running the Profile Fields Migration

## Quick Instructions

The database migration needs to be run manually in the Supabase Dashboard. Follow these simple steps:

### Step 1: Open Supabase SQL Editor

Go to: [Supabase SQL Editor](https://supabase.com/dashboard/project/qiqeyirtpstdjkkeyfss/sql/new)

Or navigate:
1. Go to https://supabase.com/dashboard
2. Select project "pensive"
3. Click "SQL Editor" in the left sidebar
4. Click "+ New query"

### Step 2: Copy and Paste This SQL

```sql
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
```

### Step 3: Run the Migration

1. Paste the SQL above into the SQL Editor
2. Click the "Run" button (or press `Cmd/Ctrl + Enter`)
3. You should see a success message

### Step 4: Verify

Run this query to verify the columns were added:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_data'
  AND column_name IN ('profile_pic', 'intro');
```

You should see two rows returned showing both columns exist.

### Step 5: Create Storage Bucket

After running the migration, you need to create a storage bucket for profile pictures:

1. Go to [Supabase Storage](https://supabase.com/dashboard/project/qiqeyirtpstdjkkeyfss/storage/buckets)
2. Click "New bucket"
3. Name: `profile-pictures`
4. Make it **Public** (toggle the public option)
5. Click "Create bucket"

### Step 6: Set Bucket Policies

Run this SQL to allow uploads:

```sql
-- Allow authenticated users to upload their own profile pictures
CREATE POLICY "Users can upload their own profile pictures"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'profile-pictures' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow anyone to view profile pictures
CREATE POLICY "Anyone can view profile pictures"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'profile-pictures');

-- Allow users to update their own profile pictures
CREATE POLICY "Users can update their own profile pictures"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'profile-pictures' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to delete their own profile pictures
CREATE POLICY "Users can delete their own profile pictures"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'profile-pictures' AND auth.uid()::text = (storage.foldername(name))[1]);
```

---

## That's it!

Once you've completed these steps:
1. ✅ Database migration applied
2. ✅ Storage bucket created
3. ✅ Storage policies set

You can now:
- Navigate to `/profile/edit` to edit your profile
- Upload a profile picture
- Add an introduction
- View your publishing page at `/:username`

---

## Troubleshooting

### Error: "column already exists"
This means the migration was already partially applied. That's okay! Just continue to the next step.

### Error: "permission denied"
Make sure you're logged into Supabase dashboard with an account that has access to the "pensive" project.

### Storage bucket already exists
If the `profile-pictures` bucket already exists, just verify it's set to public and has the correct policies.

### Can't see the columns
Try refreshing your database schema in the Supabase dashboard, or reconnect your application.
