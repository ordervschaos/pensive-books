
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Page {
  title: string;
  pageType: "text" | "section";
  content: string;
}

interface GeneratedContent {
  pages: Page[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt } = await req.json();
    
    // Get Deepseek API key
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!deepseekApiKey) throw new Error('Deepseek API key not configured');

    const systemPrompt = `You are an expert book writer that generates structured book content as JSON. The output must follow this JSON format:

    {
      "pages": [
        { // example section page
          "pageType": "section",
          "title": "Section Title",
          "content": "<h1>Section Title</h1>"
        },
        { // example text page
          "pageType": "text",
          "title": "Page Title",
          "content": "<h1>Page Title</h1><p>Page content...</p>"
        },
        // ...any other pages you generate
      ]
    }

    Rules for JSON output:
    1. The JSON response MUST have a "pages" array at the root level
    2. Each page in the array MUST have:
       - pageType: either "section" or "text"
       - title: string
       - content: string (with title wrapped in <h1>)
    3. Use proper HTML tags (<h1>, <h2>, <p>, <ul>, <ol>, <blockquote>) within content strings
    
    Return only valid JSON that matches this exact structure.`;

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
            content: systemPrompt
          },
          { 
            role: 'user', 
            content: prompt 
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      }),
    });

    const data = await response.json();
    console.log('Deepseek API response:', data);

    if (data.error) {
      throw new Error(data.error.message || 'Error from Deepseek API');
    }

    // Parse the content from the Deepseek response
    const generatedContent = JSON.parse(data.choices[0].message.content) as GeneratedContent;

    // Validate the response structure
    if (!generatedContent.pages || !Array.isArray(generatedContent.pages)) {
      throw new Error('Invalid response format: missing pages array');
    }

    // Validate each page in the array
    generatedContent.pages.forEach((page) => {
      if (!page.title || !page.content || !['section', 'text'].includes(page.pageType)) {
        throw new Error('Invalid page format in response');
      }
    });

    return new Response(JSON.stringify(generatedContent), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in generate-book-content function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
