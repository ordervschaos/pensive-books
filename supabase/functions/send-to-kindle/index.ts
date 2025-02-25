
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { JSZip } from "https://deno.land/x/jszip@0.11.0/mod.ts";

interface Page {
  title: string | null;
  html_content: string | null;
  page_type: 'section' | 'page';
  page_index: number;
}

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

    // Fetch book data and validate access
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

    // Process pages to match the Page interface
    const processedPages = pages.map(page => ({
      title: page.title,
      html_content: page.html_content,
      page_type: page.page_type as 'section' | 'page',
      page_index: page.page_index
    }));

    // Create a simple HTML version for Kindle
    const htmlContent = await generateKindleHTML(title, processedPages);
    const mobiFilename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;

    // Create email formData
    const formData = new FormData();
    formData.append('from', `Pensive <hello@${MAILGUN_DOMAIN}>`);
    formData.append('to', kindle_email);
    formData.append('subject', title);
    formData.append('text', `Your book "${title}" is attached.`);
    
    // Attach HTML file
    const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
    formData.append('attachment', htmlBlob, mobiFilename);

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

async function generateKindleHTML(title: string, pages: Page[]): Promise<string> {
  const content = pages.map(page => {
    if (page.page_type === 'section') {
      return `
        <h1 style="text-align: center; margin: 3em 0;">${page.title || 'Section'}</h1>
      `;
    } else {
      return `
        <h2>${page.title || ''}</h2>
        ${page.html_content || ''}
      `;
    }
  }).join('\n');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body { 
            font-family: serif;
            line-height: 1.6;
            margin: 0;
            padding: 1em;
          }
          h1 { text-align: center; }
          img { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        ${content}
      </body>
    </html>
  `;
}
