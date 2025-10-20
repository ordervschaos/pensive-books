import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  applied_edits?: Array<{old: string, new: string}>;
}

interface ChatRequest {
  pageId: number;
  message: string;
  pageContent: string;
  canEdit: boolean;
  conversationHistory: Message[];
}

interface ChatResponse {
  message: string;
  suggestedEdits?: Array<{old: string, new: string}>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pageId, message, pageContent, canEdit, conversationHistory }: ChatRequest = await req.json();
    
    // Get Deepseek API key
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!deepseekApiKey) throw new Error('Deepseek API key not configured');

    // Create system prompt based on user permissions
    const systemPrompt = canEdit 
      ? `You are a conversational assistant for book editing. You can answer questions about the page content, suggest improvements, and provide HTML edits. 

When suggesting edits, use this special format: [EDIT]new_html_content[/EDIT]

For multiple edits, you can provide multiple [EDIT] blocks. Each block should contain the complete new content for that specific edit.

The page content is:
${pageContent}

Be helpful, concise, and focus on improving the content quality. When suggesting edits, make sure they are specific and actionable.`
      : `You are a helpful assistant that answers questions about page content. Be concise and accurate.

The page content is:
${pageContent}

Answer questions about this content only. Do not suggest edits or changes.`;

    // Build conversation history for context
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + deepseekApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      }),
    });

    const data = await response.json();
    console.log('Deepseek API response:', data);

    if (data.error) {
      throw new Error(data.error.message || 'Error from Deepseek API');
    }

    let assistantMessage = data.choices[0].message.content.trim();
    const suggestedEdits: Array<{old: string, new: string}> = [];

    // Extract edit suggestions if in edit mode
    if (canEdit) {
      const editRegex = /\[EDIT\](.*?)\[\/EDIT\]/gs;
      let match;
      let editIndex = 0;
      
      while ((match = editRegex.exec(assistantMessage)) !== null) {
        const newContent = match[1].trim();
        
        if (editIndex === 0) {
          // First edit: replace the entire page content
          suggestedEdits.push({
            old: pageContent,
            new: newContent
          });
        } else {
          // Subsequent edits: these are alternative versions or additional options
          // We'll treat them as separate edit suggestions
          suggestedEdits.push({
            old: '', // Empty old content indicates this is an alternative edit
            new: newContent
          });
        }
        
        editIndex++;
      }
      
      // Remove edit markers from the message
      assistantMessage = assistantMessage.replace(editRegex, '').trim();
    }

    const chatResponse: ChatResponse = {
      message: assistantMessage,
      ...(suggestedEdits.length > 0 && { suggestedEdits })
    };

    return new Response(JSON.stringify(chatResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in chat-with-page function:', error);
    
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
