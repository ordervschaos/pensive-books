
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!deepseekApiKey) {
      console.error("DEEPSEEK_API_KEY is not set");
      throw new Error("API key not configured");
    }

    // Parse the request body
    const { text } = await req.json();

    if (!text || text.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'No text provided for correction' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log("Requesting correction suggestion for text:", text.substring(0, 50) + "...");

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
            content: 'You are a helpful assistant that reviews text and suggests corrections for grammar, spelling, clarity, and style. Provide concise, specific suggestions that improve the text without changing its meaning.'
          },
          {
            role: 'user',
            content: `Review this text and suggest corrections: "${text}"\n\nProvide your suggestion in the following format: "Suggested correction: [your correction here]"`
          }
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Deepseek API error:', response.status, errorData);
      throw new Error(`Deepseek API returned ${response.status}: ${errorData}`);
    }

    const data = await response.json();
    console.log("Received response from Deepseek API");

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Invalid response structure from Deepseek API:", JSON.stringify(data));
      throw new Error('Invalid response from Deepseek API');
    }

    const suggestion = data.choices[0].message.content;
    
    return new Response(
      JSON.stringify({ suggestion }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in suggest-text-correction function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to get correction suggestion' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
