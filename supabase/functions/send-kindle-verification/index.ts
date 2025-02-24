import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

const MAILGUN_API_KEY = Deno.env.get('MAILGUN_API_KEY') || '';
const MAILGUN_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') || '';
const mailgunEndpoint = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

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
    const { kindleEmail } = await req.json();
    if (!kindleEmail) {
      throw new Error('No Kindle email provided');
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store the OTP in the database with an expiration time (30 minutes)
    const { error: otpError } = await supabaseAdmin
      .from('user_data')
      .update({ 
        kindle_verification_otp: otp,
        kindle_verification_expires: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      })
      .eq('user_id', user.id);

    if (otpError) {
      throw otpError;
    }

    // Create a simple EPUB with the verification code
    const epubContent = `
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE html>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
          <title>Kindle Verification</title>
        </head>
        <body>
          <h1>Kindle Email Verification</h1>
          <p>Your verification code is: <strong>${otp}</strong></p>
          <p>This code will expire in 30 minutes.</p>
          <p>Please enter this code in the Pensive app to complete your Kindle setup.</p>
        </body>
      </html>
    `;

    // Create form data for the email
    const formData = new FormData();
    formData.append('from', `Pensive <hello@${MAILGUN_DOMAIN}>`);
    formData.append('to', kindleEmail);
    formData.append('subject', 'Kindle Email Verification');
    formData.append('html', epubContent);

    // Add the EPUB attachment
    const epubBlob = new Blob([epubContent], { type: 'application/epub+zip' });
    formData.append('attachment', epubBlob, 'verification.epub');

    // Send the email through Mailgun
    const res = await fetch(mailgunEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.message || 'Failed to send verification email');
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in send-kindle-verification function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}); 