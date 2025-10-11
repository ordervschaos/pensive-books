import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateFlashcardsRequest {
  bookId: number;
}

interface FlashcardData {
  front: string;
  back: string;
}

interface GenerateFlashcardsResponse {
  success: boolean;
  flashcards: FlashcardData[];
  error?: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Parse request body
    const { bookId }: GenerateFlashcardsRequest = await req.json();
    if (!bookId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Book ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Verify user has access to the book
    const { data: book, error: bookError } = await supabaseClient
      .from('books')
      .select('id, name, owner_id')
      .eq('id', bookId)
      .single();

    if (bookError || !book) {
      return new Response(
        JSON.stringify({ success: false, error: 'Book not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check if user has access to the book (owner or collaborator)
    const { data: bookAccess } = await supabaseClient
      .from('book_access')
      .select('*')
      .eq('book_id', bookId)
      .eq('user_id', user.id)
      .eq('status', 'accepted')
      .single();

    const hasAccess = book.owner_id === user.id || bookAccess;
    if (!hasAccess) {
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Fetch all pages for the book
    const { data: pages, error: pagesError } = await supabaseClient
      .from('pages')
      .select('id, title, html_content, page_index')
      .eq('book_id', bookId)
      .eq('archived', false)
      .order('page_index', { ascending: true });

    if (pagesError || !pages || pages.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No pages found in book' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Prepare book content for AI
    const bookContent = pages
      .map(page => {
        const cleanContent = page.html_content
          ? page.html_content.replace(/<[^>]*>/g, '').trim()
          : '';
        return `Page ${page.page_index + 1}: ${page.title}\n${cleanContent}`;
      })
      .join('\n\n');

    // Call OpenAI API to generate flashcards
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'OpenAI API key not configured' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const prompt = `Based on the following book content, generate 8-12 high-quality flashcards that would help someone study and remember the key concepts, facts, and important information from this book.

Book: "${book.name}"
Content:
${bookContent}

Please generate flashcards in the following JSON format:
{
  "flashcards": [
    {
      "front": "Question or prompt here",
      "back": "Answer or explanation here"
    }
  ]
}

Guidelines:
- Focus on the most important concepts, facts, and key information
- Make questions clear and specific
- Provide comprehensive but concise answers
- Cover different types of content: definitions, facts, concepts, processes, etc.
- Ensure flashcards are useful for learning and retention
- Avoid trivial or obvious information
- Make sure each flashcard is self-contained and meaningful

Return only the JSON response, no additional text.`;

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      console.error('OpenAI API error:', errorData);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to generate flashcards' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices[0]?.message?.content;

    if (!aiResponse) {
      return new Response(
        JSON.stringify({ success: false, error: 'No response from AI' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Parse AI response
    let flashcards: FlashcardData[];
    try {
      const parsedResponse = JSON.parse(aiResponse);
      flashcards = parsedResponse.flashcards || [];
      
      if (!Array.isArray(flashcards) || flashcards.length === 0) {
        throw new Error('Invalid flashcards format');
      }

      // Validate flashcard structure
      flashcards = flashcards.filter(card => 
        card.front && card.back && 
        typeof card.front === 'string' && 
        typeof card.back === 'string' &&
        card.front.trim().length > 0 &&
        card.back.trim().length > 0
      );

      if (flashcards.length === 0) {
        throw new Error('No valid flashcards generated');
      }
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to parse AI response' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const response: GenerateFlashcardsResponse = {
      success: true,
      flashcards: flashcards.map(card => ({
        front: card.front.trim(),
        back: card.back.trim()
      }))
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in generate-flashcards function:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
