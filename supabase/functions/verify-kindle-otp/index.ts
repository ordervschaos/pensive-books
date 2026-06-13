import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the JWT token from the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    // Create a Supabase client with the service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
    });

    // Verify the JWT token and get the user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Not authenticated');
    }

    // Parse the request body
    const { kindleEmail, code } = await req.json();
    if (!kindleEmail || !code) {
      throw new Error('Missing Kindle email or verification code');
    }

    // Fetch the stored OTP for this user
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('user_data')
      .select('kindle_verification_otp, kindle_verification_expires')
      .eq('user_id', user.id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (!userData?.kindle_verification_otp) {
      throw new Error('No verification in progress. Please request a new code.');
    }

    // Check expiry
    const expires = userData.kindle_verification_expires
      ? new Date(userData.kindle_verification_expires).getTime()
      : 0;
    if (Date.now() > expires) {
      throw new Error('Verification code has expired. Please request a new code.');
    }

    // Check the code matches
    if (String(code).trim() !== String(userData.kindle_verification_otp).trim()) {
      throw new Error('Incorrect verification code.');
    }

    // Mark the Kindle email as verified and clear the OTP
    const { error: updateError } = await supabaseAdmin
      .from('user_data')
      .update({
        kindle_email: kindleEmail,
        kindle_configured: true,
        kindle_verification_otp: null,
        kindle_verification_expires: null,
      })
      .eq('user_id', user.id);

    if (updateError) {
      throw updateError;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in verify-kindle-otp function:', error);
    return new Response(JSON.stringify({ error: (error as Error)?.message ?? String(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
