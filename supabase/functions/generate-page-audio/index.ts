import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// DEPRECATED: Helper function to convert TipTap structured content to SSML
// This function is kept for reference but is no longer used since page.content is deprecated
function processTipTapContentForTTS(content: any): string {
  if (!content || !content.content) return '';
  
  const processNode = (node: any): string => {
    if (!node) return '';
    
    switch (node.type) {
      case 'text':
        let text = node.text || '';
        
        // Apply text marks (formatting)
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
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
        
      case 'hardBreak':
        return '<break time="0.2s"/>';
        
      case 'paragraph':
        if (!node.content || node.content.length === 0) return '';
        const paragraphText = node.content.map(processNode).join('').trim();
        return paragraphText ? `${paragraphText}<break time="0.5s"/>` : '';
        
      case 'heading':
        if (!node.content || node.content.length === 0) return '';
        const headingText = node.content.map(processNode).join('').trim();
        if (!headingText) return '';
        
        const level = node.attrs?.level || 1;
        const emphasisLevel = level <= 2 ? 'strong' : 'moderate';
        const pauseTime = level === 1 ? '0.8s' : level === 2 ? '0.6s' : level === 3 ? '0.5s' : '0.4s';
        
        return `<emphasis level="${emphasisLevel}">${headingText}</emphasis><break time="${pauseTime}"/>`;
        
      case 'bulletList':
        if (!node.content || node.content.length === 0) return '';
        const listText = node.content.map(processNode).join('').trim();
        return listText ? `<break time="0.3s"/>${listText}` : '';
        
      case 'orderedList':
        if (!node.content || node.content.length === 0) return '';
        const orderedListText = node.content.map(processNode).join('').trim();
        return orderedListText ? `<break time="0.3s"/>${orderedListText}` : '';
        
      case 'listItem':
        if (!node.content || node.content.length === 0) return '';
        const itemText = node.content.map(processNode).join('').trim();
        return itemText ? `• ${itemText}<break time="0.2s"/>` : '';
        
      case 'blockquote':
        if (!node.content || node.content.length === 0) return '';
        const quoteText = node.content.map(processNode).join('').trim();
        return quoteText ? `<break time="0.3s"/>${quoteText}<break time="0.3s"/>` : '';
        
      case 'codeBlock':
        if (!node.content || node.content.length === 0) return '';
        const codeText = node.content.map(processNode).join('').trim();
        return codeText ? `<break time="0.3s"/>${codeText}<break time="0.3s"/>` : '';
        
      case 'table':
        if (!node.content || node.content.length === 0) return '';
        const tableText = node.content.map(processNode).join('').trim();
        return tableText ? `<break time="0.3s"/>${tableText}` : '';
        
      case 'tableRow':
        if (!node.content || node.content.length === 0) return '';
        const rowText = node.content.map(processNode).join('').trim();
        return rowText ? `<break time="0.2s"/>${rowText}` : '';
        
      case 'tableCell':
      case 'tableHeader':
        if (!node.content || node.content.length === 0) return '';
        const cellText = node.content.map(processNode).join('').trim();
        return cellText ? `${cellText} ` : '';
        
      case 'image':
        // Use alt text if available
        return node.attrs?.alt || '';
        
      default:
        // For unknown node types, try to process their content
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(processNode).join('').trim();
        }
        return '';
    }
  };
  
  // Process the root document
  const result = content.content.map(processNode).join('').trim();
  
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
function processHtmlForTTS(html: string): string {
  if (!html) return '';
  
  // Remove script and style tags with their content
  let processed = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove all HTML attributes (class, id, style, etc.) from opening tags
  // This cleans up tags like <h1 class="text-4xl"> to just <h1>
  processed = processed.replace(/<([a-z][a-z0-9]*)\s+[^>]*>/gi, '<$1>');
  
  // Use placeholders to prevent SSML tags from being stripped
  const EMPHASIS_START_STRONG = '___EMPHASIS_STRONG___';
  const EMPHASIS_END = '___EMPHASIS_END___';
  const EMPHASIS_START_MODERATE = '___EMPHASIS_MODERATE___';
  const BREAK_05 = '___BREAK_05___';
  const BREAK_04 = '___BREAK_04___';
  const BREAK_03 = '___BREAK_03___';
  
  // Add SSML emphasis for headings (h1-h6)
  // h1 and h2 get strong emphasis, h3-h6 get moderate emphasis
  processed = processed.replace(/<h1[^>]*>(.*?)<\/h1>/gi, `${EMPHASIS_START_STRONG}$1${EMPHASIS_END}${BREAK_05}`);
  processed = processed.replace(/<h2[^>]*>(.*?)<\/h2>/gi, `${EMPHASIS_START_STRONG}$1${EMPHASIS_END}${BREAK_05}`);
  processed = processed.replace(/<h3[^>]*>(.*?)<\/h3>/gi, `${EMPHASIS_START_MODERATE}$1${EMPHASIS_END}${BREAK_04}`);
  processed = processed.replace(/<h4[^>]*>(.*?)<\/h4>/gi, `${EMPHASIS_START_MODERATE}$1${EMPHASIS_END}${BREAK_04}`);
  processed = processed.replace(/<h5[^>]*>(.*?)<\/h5>/gi, `${EMPHASIS_START_MODERATE}$1${EMPHASIS_END}${BREAK_03}`);
  processed = processed.replace(/<h6[^>]*>(.*?)<\/h6>/gi, `${EMPHASIS_START_MODERATE}$1${EMPHASIS_END}${BREAK_03}`);
  
  // Add pauses for paragraphs
  processed = processed.replace(/<\/p>/gi, BREAK_03);
  
  // Add pauses for line breaks
  processed = processed.replace(/<br\s*\/?>/gi, BREAK_03);
  
  // Add pauses for list items
  processed = processed.replace(/<\/li>/gi, BREAK_03);
  
  // Add pauses after blockquotes
  processed = processed.replace(/<\/blockquote>/gi, BREAK_03);
  
  // Remove all remaining HTML tags
  processed = processed.replace(/<[^>]*>/g, ' ');
  
  // Decode common HTML entities BEFORE converting to SSML
  processed = decodeHtmlEntities(processed);
  
  // Convert placeholders to SSML tags
  processed = processed.replace(new RegExp(EMPHASIS_START_STRONG, 'g'), '<emphasis level="strong">');
  processed = processed.replace(new RegExp(EMPHASIS_START_MODERATE, 'g'), '<emphasis level="moderate">');
  processed = processed.replace(new RegExp(EMPHASIS_END, 'g'), '</emphasis>');
  processed = processed.replace(new RegExp(BREAK_05, 'g'), '<break time="0.5s"/>');
  processed = processed.replace(new RegExp(BREAK_04, 'g'), '<break time="0.4s"/>');
  processed = processed.replace(new RegExp(BREAK_03, 'g'), '<break time="0.3s"/>');
  
  // Normalize whitespace: replace multiple spaces/newlines with single space
  // Do this AFTER SSML conversion to preserve the SSML tags
  processed = processed.replace(/\s+/g, ' ').trim();
  
  return processed;
}

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
      .select('id, title, html_content')
      .eq('id', pageId)
      .single()

    if (pageError || !page) {
      throw new Error('Page not found')
    }

    // Generate content hash from HTML content
    const contentForHash = page.html_content || ''
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

    // Process HTML content for TTS
    const ttsText = processHtmlForTTS(page.html_content || '');
    
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
