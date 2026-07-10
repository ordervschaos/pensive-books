-- Add RLS policy to allow users to update their own user_data
DROP POLICY IF EXISTS "Users can update their own data" ON user_data;

CREATE POLICY "Users can update their own data"
ON user_data
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
