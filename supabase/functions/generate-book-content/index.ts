
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, pageType } = await req.json();

    const systemPrompt = pageType === "text" 
      ? "You are an assistant that generates structured book content with multiple pages. Each page should have a title and HTML content with proper formatting. Generate rich, well-formatted content using HTML tags for headings, paragraphs, lists, and other elements."
      : "You are an assistant that generates section titles for books. Each section should be a single h1 heading in HTML format, focused on being concise and impactful.";

    const formatInstructions = pageType === "text"
      ? "Generate multiple pages. For each page, provide a title and HTML content. The content should use proper HTML formatting with tags like <h2>, <p>, <ul>, <ol>, <blockquote>, etc."
      : "Generate multiple section titles, each as an <h1> tag. These should be structured as chapter or section headings.";

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: `${systemPrompt} Format the output as a JSON array of pages, where each page has a "title" and "content" field. ${formatInstructions}`
          },
          { 
            role: 'user', 
            content: prompt 
          }
        ],
        response_format: { type: "json_object" }
      }),
    });

    const data = await response.json();
    const generatedContent = JSON.parse(data.choices[0].message.content);

    // Ensure each page has the correct type
    const pages = generatedContent.pages.map((page: any) => ({
      ...page,
      type: pageType
    }));

    return new Response(JSON.stringify({ pages }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in generate-book-content function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
