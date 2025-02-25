
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";
import { generateEPUB } from "../../src/lib/epub.ts";

const MAILGUN_API_KEY = Deno.env.get('MAILGUN_API_KEY') || '';
const MAILGUN_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') || '';
const mailgunEndpoint = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
    });

    // Verify the user
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

    // Fetch book data
    const { data: book, error: bookError } = await supabaseAdmin
      .from('books')
      .select('*')
      .eq('id', bookId)
      .single();

    if (bookError || !book) {
      throw new Error('Book not found');
    }

    // Fetch pages
    const { data: pages, error: pagesError } = await supabaseAdmin
      .from('pages')
      .select('*')
      .eq('book_id', bookId)
      .eq('archived', false)
      .order('page_index', { ascending: true });

    if (pagesError || !pages) {
      throw new Error('Failed to fetch pages');
    }

    // Generate EPUB content
    const processedPages = pages.map(page => ({
      ...page,
      page_type: page.page_type as 'section' | 'page'
    }));

    const epubBlob = await generateEPUB(
      {
        title: book.name,
        author: book.author,
        subtitle: book.subtitle,
        identifier: bookId.toString(),
        coverUrl: book.cover_url
      },
      processedPages,
      [], // No images for now to keep it simple
      false // Don't show text on cover
    );

    // Convert blob to base64
    const buffer = await epubBlob.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    // Prepare email with attachment
    const formData = new FormData();
    formData.append('from', `Pensive <hello@${MAILGUN_DOMAIN}>`);
    formData.append('to', kindle_email);
    formData.append('subject', title);
    formData.append('text', `Your book "${title}" is attached. It will appear on your Kindle shortly.`);
    
    // Attach the EPUB file
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/epub+zip' });
    formData.append('attachment', blob, `${title}.epub`);

    // Send via Mailgun
    const mailgunRes = await fetch(mailgunEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`
      },
      body: formData
    });

    if (!mailgunRes.ok) {
      const errorData = await mailgunRes.json();
      throw new Error(errorData.message || 'Failed to send email');
    }

    console.log('Successfully sent book to Kindle');

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
