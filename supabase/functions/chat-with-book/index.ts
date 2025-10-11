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
  suggested_operations?: Array<{
    type: 'add' | 'archive' | 'move' | 'edit';
    pageId?: number;
    newIndex?: number;
    title?: string;
    content?: string;
    oldContent?: string;
    newContent?: string;
  }>;
}

interface BookPage {
  id: number;
  title: string;
  pageIndex: number;
  summary: string;
}

interface BookMetadata {
  name: string;
  author: string;
  subtitle: string;
  pageCount: number;
  pages: BookPage[];
}

interface ChatRequest {
  bookId: number;
  message: string;
  bookMetadata: BookMetadata;
  canEdit: boolean;
  conversationHistory: Message[];
}

interface ChatResponse {
  message: string;
  suggestedOperations?: Array<{
    type: 'add' | 'archive' | 'move' | 'edit';
    pageId?: number;
    newIndex?: number;
    title?: string;
    content?: string;
    oldContent?: string;
    newContent?: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookId, message, bookMetadata, canEdit, conversationHistory }: ChatRequest = await req.json();
    
    // Get Deepseek API key
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!deepseekApiKey) throw new Error('Deepseek API key not configured');

    // Build pages summary for context
    console.log('Book metadata pages:', JSON.stringify(bookMetadata.pages, null, 2));
    const pagesSummary = bookMetadata.pages
      .sort((a, b) => a.pageIndex - b.pageIndex)
      .map(page => `Page ${page.pageIndex + 1} (ID: ${page.id}): "${page.title}" - ${page.summary}`)
      .join('\n');
    console.log('Pages summary for AI:', pagesSummary);

    // Create system prompt based on user permissions
    const systemPrompt = canEdit 
      ? `You are a conversational assistant for book editing and management. You can answer questions about the book structure, content, and suggest structural changes.

Book Information:
- Title: ${bookMetadata.name}
- Author: ${bookMetadata.author || 'Unknown'}
- Subtitle: ${bookMetadata.subtitle || 'None'}
- Total Pages: ${bookMetadata.pageCount}

Page Structure:
${pagesSummary}

You can suggest the following operations using special markup:
- Add a new page: [ADD_PAGE]after_page_index|title|content[/ADD_PAGE]
- Archive a page: [ARCHIVE_PAGE]page_id[/ARCHIVE_PAGE] (use the actual page ID from the list above)
- Move a page: [MOVE_PAGE]page_id|new_index[/MOVE_PAGE] (use the actual page ID from the list above)
- Edit page content: [EDIT_PAGE]page_id|old_content|new_content[/EDIT_PAGE] (use the actual page ID from the list above)

IMPORTANT: Always use the exact page IDs shown in the page list above. Do not make up or guess page IDs.

Be helpful, concise, and focus on improving the book structure and content quality. When suggesting operations, make sure they are specific and actionable.`
      : `You are a helpful assistant that answers questions about book content and structure. Be concise and accurate.

Book Information:
- Title: ${bookMetadata.name}
- Author: ${bookMetadata.author || 'Unknown'}
- Subtitle: ${bookMetadata.subtitle || 'None'}
- Total Pages: ${bookMetadata.pageCount}

Page Structure:
${pagesSummary}

Answer questions about this book's content and structure only. Do not suggest edits or changes.`;

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
    const suggestedOperations: Array<{
      type: 'add' | 'archive' | 'move' | 'edit';
      pageId?: number;
      newIndex?: number;
      title?: string;
      content?: string;
      oldContent?: string;
      newContent?: string;
    }> = [];

    // Extract operation suggestions if in edit mode
    if (canEdit) {
      // Parse ADD_PAGE operations
      const addPageRegex = /\[ADD_PAGE\](.*?)\|(.*?)\|(.*?)\[\/ADD_PAGE\]/gs;
      let match;
      
      while ((match = addPageRegex.exec(assistantMessage)) !== null) {
        suggestedOperations.push({
          type: 'add',
          newIndex: parseInt(match[1].trim()),
          title: match[2].trim(),
          content: match[3].trim()
        });
      }

      // Parse ARCHIVE_PAGE operations
      const archivePageRegex = /\[ARCHIVE_PAGE\](.*?)\[\/ARCHIVE_PAGE\]/gs;
      while ((match = archivePageRegex.exec(assistantMessage)) !== null) {
        const pageId = parseInt(match[1].trim());
        console.log('Parsed ARCHIVE_PAGE operation:', { raw: match[1].trim(), parsed: pageId });
        suggestedOperations.push({
          type: 'archive',
          pageId: pageId
        });
      }

      // Parse MOVE_PAGE operations
      const movePageRegex = /\[MOVE_PAGE\](.*?)\|(.*?)\[\/MOVE_PAGE\]/gs;
      while ((match = movePageRegex.exec(assistantMessage)) !== null) {
        suggestedOperations.push({
          type: 'move',
          pageId: parseInt(match[1].trim()),
          newIndex: parseInt(match[2].trim())
        });
      }

      // Parse EDIT_PAGE operations
      const editPageRegex = /\[EDIT_PAGE\](.*?)\|(.*?)\|(.*?)\[\/EDIT_PAGE\]/gs;
      while ((match = editPageRegex.exec(assistantMessage)) !== null) {
        suggestedOperations.push({
          type: 'edit',
          pageId: parseInt(match[1].trim()),
          oldContent: match[2].trim(),
          newContent: match[3].trim()
        });
      }
      
      // Remove operation markers from the message
      assistantMessage = assistantMessage
        .replace(addPageRegex, '')
        .replace(archivePageRegex, '')
        .replace(movePageRegex, '')
        .replace(editPageRegex, '')
        .trim();
    }

    const chatResponse: ChatResponse = {
      message: assistantMessage,
      ...(suggestedOperations.length > 0 && { suggestedOperations })
    };
    
    console.log('Final chat response:', JSON.stringify(chatResponse, null, 2));

    return new Response(JSON.stringify(chatResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in chat-with-book function:', error);
    
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
