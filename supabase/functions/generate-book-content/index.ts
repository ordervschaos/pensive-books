import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Add Deno namespace declaration for TypeScript
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

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

    const systemPrompt = 'You are an expert book writer that generates structured book content as JSON. The output must follow this JSON format:\n\n' +
    '{\n' +
    '  "pages": [\n' +
    '    { // example section page\n' +
    '      "pageType": "section",\n' +
    '      "title": "Section Title",\n' +
    '      "content": "<h1>Section Title</h1>"\n' +
    '    },\n' +
    '    { // example text page\n' +
    '      "pageType": "text",\n' +
    '      "title": "Page Title",\n' +
    '      "content": "<h1>Page Title</h1><p>Page content...</p>"\n' +
    '    },\n' +
    '    // ...any other pages you generate\n' +
    '  ]\n' +
    '}\n\n' +
    'Rules for JSON output:\n' +
    '1. The JSON response MUST have a "pages" array at the root level\n' +
    '2. Each page in the array MUST have:\n' +
    '   - pageType: either "section" or "text"\n' +
    '   - title: string\n' +
    '   - content: string (with title wrapped in <h1>)\n' +
    '3. Use proper HTML tags (<h1>, <h2>, <p>, <ul>, <ol>, <blockquote>) within content strings\n\n' +
    'CRITICAL: Your response MUST be ONLY the raw JSON object with no additional text. DO NOT wrap it in markdown code blocks (```). DO NOT include any explanations or text before or after the JSON. DO NOT include any markdown formatting. The response should start with { and end with } and be valid parseable JSON.\n\n' +
    'Return only valid JSON that matches this exact structure.';

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + deepseekApiKey,
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

    // Extract the content from the Deepseek response
    let contentString = data.choices[0].message.content;
    console.log('Raw content from API:', contentString);
    
    // More robust cleanup for markdown and text formatting
    const cleanContent = (content: string): string => {
      let cleaned = content.trim();
      
      // Remove markdown code blocks
      if (cleaned.includes('```')) {
        // First try to extract content from code blocks
        const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          cleaned = codeBlockMatch[1].trim();
        } else {
          // If no match, just remove all ``` markers
          cleaned = cleaned.replace(/```(?:json)?/g, '').trim();
        }
      }
      
      // Remove any text before the first { and after the last }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      
      return cleaned;
    };
    
    contentString = cleanContent(contentString);
    console.log('Cleaned content for parsing:', contentString);
    
    // Parse the cleaned content
    let generatedContent: GeneratedContent;
    try {
      generatedContent = JSON.parse(contentString) as GeneratedContent;
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      console.log('Content that failed to parse:', contentString);
      
      // Last resort: try to manually fix common JSON issues
      try {
        // Replace any remaining markdown artifacts
        let fixedContent = contentString
          .replace(/^[\s\S]*?(\{)/m, '$1') // Remove anything before first {
          .replace(/\}[\s\S]*$/m, '}')     // Remove anything after last }
          .replace(/\\"/g, '"')            // Fix escaped quotes
          .replace(/\\n/g, ' ')            // Replace newlines with spaces
          .replace(/\/\/.+$/gm, '')        // Remove comments
          .replace(/,\s*\}/g, '}')         // Remove trailing commas
          .replace(/,\s*\]/g, ']');        // Remove trailing commas in arrays
          
        console.log('Attempting to parse fixed content:', fixedContent);
        generatedContent = JSON.parse(fixedContent) as GeneratedContent;
        console.log('Successfully parsed fixed content');
      } catch (secondError) {
        throw new Error('Failed to parse JSON response: ' + parseError.message);
      }
    }

    console.log('Successfully parsed content into JSON');

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
    
    // Provide a fallback response if the API fails to return valid JSON
    if (error.message && error.message.includes('JSON')) {
      // Create a minimal fallback response
      const fallbackContent: GeneratedContent = {
        pages: [
          {
            pageType: "section",
            title: "Error Processing Request",
            content: "<h1>Error Processing Request</h1>"
          },
          {
            pageType: "text",
            title: "We encountered an issue",
            content: "<h1>We encountered an issue</h1><p>We're sorry, but we couldn't generate the book content you requested. Please try again with a different prompt.</p>"
          }
        ]
      };
      
      console.log('Returning fallback content due to JSON parsing error');
      return new Response(JSON.stringify(fallbackContent), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
