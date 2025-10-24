import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function RunMigration() {
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (log: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${log}`]);
  };

  const runMigration = async () => {
    setStatus('running');
    setLogs([]);
    addLog('Starting migration...');

    try {
      // Step 1: Add profile_pic column
      addLog('Adding profile_pic column to user_data...');
      const { error: error1 } = await supabase.rpc('exec_sql', {
        query: 'ALTER TABLE user_data ADD COLUMN IF NOT EXISTS profile_pic TEXT;'
      });

      if (error1) {
        // Try direct approach via service role
        addLog('Trying direct SQL execution...');
        const response1 = await fetch('/api/run-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sql: 'ALTER TABLE user_data ADD COLUMN IF NOT EXISTS profile_pic TEXT;'
          })
        });

        if (!response1.ok) {
          throw new Error('Failed to add profile_pic column');
        }
      }
      addLog('✓ profile_pic column added');

      // Step 2: Add intro column
      addLog('Adding intro column to user_data...');
      const { error: error2 } = await supabase.rpc('exec_sql', {
        query: 'ALTER TABLE user_data ADD COLUMN IF NOT EXISTS intro TEXT;'
      });

      if (error2) {
        const response2 = await fetch('/api/run-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sql: 'ALTER TABLE user_data ADD COLUMN IF NOT EXISTS intro TEXT;'
          })
        });

        if (!response2.ok) {
          throw new Error('Failed to add intro column');
        }
      }
      addLog('✓ intro column added');

      // Step 3: Update view
      addLog('Updating public_user_profiles view...');
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
        query: viewSQL
      });

      if (error3) {
        throw new Error('Failed to update view: ' + error3.message);
      }
      addLog('✓ View updated');

      // Step 4: Verify
      addLog('Verifying changes...');
      const { data, error: verifyError } = await supabase
        .from('public_user_profiles')
        .select('user_id, username, profile_pic, intro')
        .limit(1);

      if (verifyError) {
        throw new Error('Verification failed: ' + verifyError.message);
      }

      addLog('✓ Verification successful');
      addLog('Migration completed successfully!');

      setStatus('success');
      setMessage('Migration completed! You can now use the profile features.');

    } catch (error: any) {
      addLog('❌ Error: ' + error.message);
      setStatus('error');
      setMessage(error.message || 'Migration failed. Please run manually in Supabase Dashboard.');
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Database Migration Runner</CardTitle>
            <CardDescription>
              Run the profile fields migration to add profile_pic and intro columns
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {status === 'idle' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This will add two new columns to the user_data table:
                </p>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  <li>profile_pic (TEXT) - URL to profile picture</li>
                  <li>intro (TEXT) - User introduction/bio</li>
                </ul>
                <p className="text-sm text-muted-foreground">
                  It will also update the public_user_profiles view to include these fields.
                </p>
                <Button onClick={runMigration} size="lg">
                  Run Migration
                </Button>
              </div>
            )}

            {status === 'running' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Running migration...</span>
                </div>
              </div>
            )}

            {status === 'success' && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  {message}
                </AlertDescription>
              </Alert>
            )}

            {status === 'error' && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  {message}
                  <div className="mt-4">
                    <p className="font-semibold mb-2">Manual Migration:</p>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
{`-- Run this in Supabase SQL Editor:
ALTER TABLE user_data
ADD COLUMN IF NOT EXISTS profile_pic TEXT,
ADD COLUMN IF NOT EXISTS intro TEXT;

CREATE OR REPLACE VIEW public_user_profiles AS
SELECT user_id, username, email, profile_pic, intro, created_at
FROM user_data WHERE username IS NOT NULL;

GRANT SELECT ON public_user_profiles TO authenticated, anon;`}
                    </pre>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {logs.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-2">Migration Log:</h3>
                <div className="bg-muted p-4 rounded-md space-y-1 max-h-96 overflow-y-auto">
                  {logs.map((log, i) => (
                    <div key={i} className="text-xs font-mono">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
