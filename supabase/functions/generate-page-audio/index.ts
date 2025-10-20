import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper function to convert TipTap structured content to SSML
function processTipTapContentForTTS(content: Record<string, unknown>): string {
  if (!content || !content.content) return '';
  
  const processNode = (node: Record<string, unknown>): string => {
    if (!node) return '';
    
    switch (node.type as string) {
      case 'text': {
        let text = (node.text as string) || '';
        
        // Apply text marks (formatting)
        if (node.marks && Array.isArray(node.marks)) {
          for (const mark of node.marks as Record<string, unknown>[]) {
            switch (mark.type as string) {
              case 'bold':
                text = `<emphasis level="moderate">${text}</emphasis>`;
                break;
              case 'italic':
                text = `<emphasis level="reduced">${text}</emphasis>`;
                break;
              case 'code':
                // Keep code as plain text
                break;
              case 'link':
                // Just use the text, not the URL
                break;
            }
          }
        }
        
        return text;
      }
        
      case 'hardBreak':
        return '<break time="0.2s"/>';
        
      case 'paragraph': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const paragraphText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return paragraphText ? `${paragraphText}<break time="0.5s"/>` : '';
      }
        
      case 'heading': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const headingText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        if (!headingText) return '';
        
        const attrs = node.attrs as Record<string, unknown> || {};
        const level = (attrs.level as number) || 1;
        const emphasisLevel = level <= 2 ? 'strong' : 'moderate';
        const pauseTime = level === 1 ? '0.8s' : level === 2 ? '0.6s' : level === 3 ? '0.5s' : '0.4s';
        
        return `<emphasis level="${emphasisLevel}">${headingText}</emphasis><break time="${pauseTime}"/>`;
      }
        
      case 'bulletList': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const listText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return listText ? `<break time="0.3s"/>${listText}` : '';
      }
        
      case 'orderedList': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const orderedListText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return orderedListText ? `<break time="0.3s"/>${orderedListText}` : '';
      }
        
      case 'listItem': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const itemText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return itemText ? `• ${itemText}<break time="0.2s"/>` : '';
      }
        
      case 'blockquote': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const quoteText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return quoteText ? `<break time="0.3s"/>${quoteText}<break time="0.3s"/>` : '';
      }
        
      case 'codeBlock': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const codeText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return codeText ? `<break time="0.3s"/>${codeText}<break time="0.3s"/>` : '';
      }
        
      case 'table': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const tableText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return tableText ? `<break time="0.3s"/>${tableText}` : '';
      }
        
      case 'tableRow': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const rowText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return rowText ? `<break time="0.2s"/>${rowText}` : '';
      }
        
      case 'tableCell':
      case 'tableHeader': {
        if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return '';
        const cellText = (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        return cellText ? `${cellText} ` : '';
      }
        
      case 'image': {
        // Use alt text if available
        const attrs = node.attrs as Record<string, unknown> || {};
        return (attrs.alt as string) || '';
      }
        
        
      default:
        // For unknown node types, try to process their content
        if (node.content && Array.isArray(node.content)) {
          return (node.content as Record<string, unknown>[]).map(processNode).join('').trim();
        }
        return '';
    }
  };
  
  // Process the root document
  const result = (content.content as Record<string, unknown>[]).map(processNode).join('').trim();
  
  // Clean up multiple spaces and ensure proper spacing
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Decode HTML entities to their character equivalents
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '...',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&euro;': '€',
    '&pound;': '£',
    '&yen;': '¥',
    '&cent;': '¢',
    '&rsquo;': '\u2019',
    '&lsquo;': '\u2018',
    '&rdquo;': '\u201D',
    '&ldquo;': '\u201C',
    '&egrave;': 'è',
    '&eacute;': 'é',
    '&ecirc;': 'ê',
    '&agrave;': 'à',
    '&acirc;': 'â',
    '&ccedil;': 'ç',
  };
  
  let decoded = text;
  
  // Replace named entities
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }
  
  // Replace numeric entities (e.g., &#8211; or &#x2013;)
  decoded = decoded.replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 10)));
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_: string, code: string) => String.fromCharCode(parseInt(code, 16)));
  
  return decoded;
}

/**
 * Convert HTML to SSML-enhanced text suitable for Text-to-Speech (TTS)
 * This function:
 * 1. Removes script and style tags
 * 2. Removes HTML attributes (class, id, style, etc.)
 * 3. Converts HTML structure to SSML with emphasis and pauses
 * 4. Decodes HTML entities
 * 5. Normalizes whitespace
 */

// Helper function to generate a simple hash
function generateContentHash(text: string): string {
  let hash = 0
  if (text.length === 0) return hash.toString()
  
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { pageId, forceRegenerate = false } = await req.json()
    
    if (!pageId) {
      throw new Error('pageId is required')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get Eleven Labs API key
    const elevenLabsApiKey = Deno.env.get('ELEVEN_LABS_API_KEY')
    if (!elevenLabsApiKey) {
      throw new Error('ELEVEN_LABS_API_KEY not found')
    }

    // Fetch page content
    const { data: page, error: pageError } = await supabase
      .from('pages')
      .select('id, title, content')
      .eq('id', pageId)
      .single()

    if (pageError || !page) {
      throw new Error('Page not found')
    }

    // Generate content hash from TipTap JSON content
    const contentForHash = JSON.stringify(page.content || {})
    const contentHash = generateContentHash(contentForHash)
    
    // Check if audio already exists for this content (skip if forceRegenerate is true)
    if (!forceRegenerate) {
      const { data: existingAudio, error: audioError } = await supabase
        .from('page_audio')
        .select('*')
        .eq('page_id', pageId)
        .eq('content_hash', contentHash)
        .single()

      if (existingAudio && !audioError) {
        // Return existing audio
        return new Response(
          JSON.stringify({
            audioUrl: existingAudio.audio_url,
            duration: existingAudio.audio_duration,
            characterCount: existingAudio.character_count,
            cached: true
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }
    }

    // Process TipTap content for TTS
    const ttsText = processTipTapContentForTTS(page.content);
    
    if (!ttsText || ttsText.length < 10) {
      throw new Error('Page content is too short for text-to-speech')
    }

    // Limit character count to control costs (5000 chars max)
    const textForTTS = ttsText.length > 5000 
      ? ttsText.substring(0, 5000) + '...'
      : ttsText

    console.log(`Generating audio for page ${pageId}, ${textForTTS.length} characters`)

    // Call Eleven Labs API
    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb`, // Default voice: Rachel
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsApiKey,
        },
        body: JSON.stringify({
          text: `<speak>${textForTTS}</speak>`,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
            style: 0.0,
            use_speaker_boost: true
          }
        }),
      }
    )

    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text()
      console.error('Eleven Labs API error:', errorText)
      throw new Error(`Eleven Labs API error: ${elevenLabsResponse.status}`)
    }

    // Get audio blob
    const audioBlob = await elevenLabsResponse.arrayBuffer()
    
    // Upload to Supabase Storage
    const fileName = `page-${pageId}-${Date.now()}.mp3`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('page-audio')
      .upload(fileName, audioBlob, {
        contentType: 'audio/mpeg',
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      throw new Error('Failed to upload audio to storage')
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('page-audio')
      .getPublicUrl(fileName)

    // Estimate duration (rough calculation: ~150 words per minute)
    const wordCount = textForTTS.split(/\s+/).length
    const estimatedDuration = Math.ceil((wordCount / 150) * 60) // seconds

    // Save to database (upsert on page_id since it's unique)
    const { data: audioRecord, error: saveError } = await supabase
      .from('page_audio')
      .upsert({
        page_id: pageId,
        audio_url: urlData.publicUrl,
        audio_duration: estimatedDuration,
        character_count: textForTTS.length,
        voice_id: 'JBFqnCBsd6RMkjVDRZzb',
        content_hash: contentHash
      }, {
        onConflict: 'page_id'
      })
      .select()
      .single()

    if (saveError) {
      console.error('Database save error:', saveError)
      throw new Error('Failed to save audio metadata')
    }

    return new Response(
      JSON.stringify({
        audioUrl: urlData.publicUrl,
        duration: estimatedDuration,
        characterCount: textForTTS.length,
        cached: false
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in generate-page-audio function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
