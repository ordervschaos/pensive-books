import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookId, prompt } = await req.json();
    console.log(`Processing book ${bookId} with prompt: ${prompt}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all pages from the book
    const { data: pages, error: pagesError } = await supabase
      .from('pages')
      .select('*')
      .eq('book_id', bookId)
      .eq('archived', false)
      .order('page_index', { ascending: true });

    if (pagesError) throw pagesError;
    if (!pages?.length) throw new Error('No pages found in this book');

    // Get Deepseek API key
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!deepseekApiKey) throw new Error('Deepseek API key not configured');

    // Process each page
    const updatedPages = await Promise.all(pages.map(async (page) => {
      if (page.page_type !== 'text') return page; // Skip section pages

      // Get current content without HTML tags
      const currentContent = page.html_content
        ? page.html_content.replace(/<[^>]*>/g, '').trim()
        : '';

      // Generate new content
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${deepseekApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `You are an AI that expands on existing text content. ${prompt}`
            },
            {
              role: 'user',
              content: `Here's the current content:\n\n${currentContent}\n\nPlease expand on this content, adding more details and depth while maintaining the same style and tone. Return the expanded content in HTML format with appropriate tags (<p>, <h1>, <h2>, <ul>, <li>, etc).`
            }
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message || 'Error from Deepseek API');
      
      // Get the raw content from the API response
      let newContent = data.choices[0].message.content.trim();
      
      // Remove markdown code block delimiters if present
      newContent = newContent.replace(/^```html\n?/, '').replace(/```$/, '');

      // Update the page with expanded content
      const { error: updateError } = await supabase
        .from('pages')
        .update({ 
          html_content: newContent,
          updated_at: new Date().toISOString()
        })
        .eq('id', page.id);

      if (updateError) throw updateError;

      return { ...page, html_content: newContent };
    }));

    return new Response(JSON.stringify({ 
      message: 'Book content expanded successfully',
      pages: updatedPages 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in flesh-out-book function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
