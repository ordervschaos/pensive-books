
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

const MAILGUN_API_KEY = Deno.env.get('MAILGUN_API_KEY') || '';
const MAILGUN_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') || '';
const PUBLIC_SITE_URL = Deno.env.get('PUBLIC_SITE_URL') || '';
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

    // Get request data
    const { bookId, title, kindle_email } = await req.json();
    
    if (!bookId || !title || !kindle_email) {
      throw new Error('Missing required fields');
    }

    // Fetch the book and its pages
    const { data: book, error: bookError } = await supabaseAdmin
      .from('books')
      .select('*')
      .eq('id', bookId)
      .single();

    if (bookError || !book) {
      throw new Error('Book not found');
    }

    const { data: pages, error: pagesError } = await supabaseAdmin
      .from('pages')
      .select('*')
      .eq('book_id', bookId)
      .eq('archived', false)
      .order('page_index', { ascending: true });

    if (pagesError) {
      throw new Error('Failed to fetch pages');
    }

    // Generate EPUB content on the server
    const formData = new FormData();
    formData.append('from', `Pensive <hello@${MAILGUN_DOMAIN}>`);
    formData.append('to', kindle_email);
    formData.append('subject', title);
    formData.append('text', `Your book "${title}" is ready for reading on your Kindle.`);

    // Create a unique identifier for the book
    const uniqueId = crypto.randomUUID();
    const epubUrl = `${PUBLIC_SITE_URL}/api/generate-epub/${uniqueId}`;
    formData.append('attachment', epubUrl);
    
    // Send email via Mailgun
    const mailgunRes = await fetch(mailgunEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
      },
      body: formData,
    });

    if (!mailgunRes.ok) {
      const errorData = await mailgunRes.json();
      throw new Error(errorData.message || 'Failed to send email');
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in send-to-kindle function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
