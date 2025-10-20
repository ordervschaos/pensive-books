import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AudioBlock {
  index: number;
  type: string;
  textContent: string;
  level?: number;
}

/**
 * Extract text content from TipTap node
 */
function extractTextFromNode(node: any): string {
  if (node.type === 'text') {
    return node.text || '';
  }

  if (node.content && Array.isArray(node.content)) {
    // Join child content
    return node.content.map((child: any) => extractTextFromNode(child)).join('');
  }

  return '';
}

/**
 * Check if a node contains meaningful text content
 */
function hasTextContent(node: any): boolean {
  const text = extractTextFromNode(node).trim();
  return text.length > 0;
}

/**
 * Extract text from a list item, excluding nested lists
 */
function extractListItemText(item: any): string {
  if (!item.content || !Array.isArray(item.content)) {
    return '';
  }
  
  // Only extract text from direct paragraphs/text, skip nested lists
  const textParts: string[] = [];
  for (const child of item.content) {
    if (child.type === 'paragraph') {
      const text = extractTextFromNode(child).trim();
      if (text) {
        textParts.push(text);
      }
    }
    // Skip bulletList and orderedList - they'll be processed recursively
  }
  
  return textParts.join(' ');
}

/**
 * Process list items into individual audio blocks (handles nested lists recursively)
 */
function processListItems(
  listNode: any,
  blockIndex: number,
  blocks: AudioBlock[]
): number {
  if (!listNode.content || !Array.isArray(listNode.content)) {
    return blockIndex;
  }

  for (const item of listNode.content) {
    if (item.type === 'listItem') {
      // Extract text from this list item (excluding nested lists)
      const text = extractListItemText(item).trim();
      if (text) {
        blocks.push({
          index: blockIndex++,
          type: 'listItem',
          textContent: text,
        });
      }
      
      // Now process any nested lists within this item
      if (item.content && Array.isArray(item.content)) {
        for (const child of item.content) {
          if (child.type === 'bulletList' || child.type === 'orderedList') {
            blockIndex = processListItems(child, blockIndex, blocks);
          }
        }
      }
    }
  }

  return blockIndex;
}

/**
 * Split large paragraph into smaller chunks
 */
function splitLargeParagraph(text: string, startIndex: number): AudioBlock[] {
  const blocks: AudioBlock[] = [];
  const maxWords = 150;
  
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = '';
  let chunkIndex = startIndex;
  
  for (const sentence of sentences) {
    const words = (currentChunk + ' ' + sentence).trim().split(/\s+/);
    
    if (words.length > maxWords && currentChunk) {
      blocks.push({
        index: chunkIndex++,
        type: 'paragraph',
        textContent: currentChunk.trim(),
      });
      currentChunk = sentence;
    } else {
      currentChunk = (currentChunk + ' ' + sentence).trim();
    }
  }
  
  if (currentChunk.trim()) {
    blocks.push({
      index: chunkIndex++,
      type: 'paragraph',
      textContent: currentChunk.trim(),
    });
  }
  
  return blocks;
}

/**
 * Extract audio blocks from TipTap JSON
 */
function extractAudioBlocks(tiptapJSON: any): AudioBlock[] {
  const blocks: AudioBlock[] = [];
  let blockIndex = 0;

  if (!tiptapJSON || !tiptapJSON.content || !Array.isArray(tiptapJSON.content)) {
    return blocks;
  }

  for (const node of tiptapJSON.content) {
    if (!hasTextContent(node)) {
      continue;
    }

    const text = extractTextFromNode(node).trim();
    if (!text) {
      continue;
    }

    switch (node.type) {
      case 'heading':
        blocks.push({
          index: blockIndex++,
          type: 'heading',
          textContent: text,
          level: node.attrs?.level || 1,
        });
        break;

      case 'paragraph':
        const wordCount = text.split(/\s+/).length;
        if (wordCount > 150) {
          const subBlocks = splitLargeParagraph(text, blockIndex);
          blocks.push(...subBlocks);
          blockIndex += subBlocks.length;
        } else {
          blocks.push({
            index: blockIndex++,
            type: 'paragraph',
            textContent: text,
          });
        }
        break;

      case 'blockquote':
        blocks.push({
          index: blockIndex++,
          type: 'blockquote',
          textContent: text,
        });
        break;

      case 'bulletList':
      case 'orderedList':
        blockIndex = processListItems(node, blockIndex, blocks);
        break;

      case 'codeBlock':
        blocks.push({
          index: blockIndex++,
          type: 'codeBlock',
          textContent: 'Code block',
        });
        break;

      default:
        if (text.length > 10) {
          blocks.push({
            index: blockIndex++,
            type: node.type || 'unknown',
            textContent: text,
          });
        }
    }
  }

  return blocks;
}

/**
 * Generate a simple hash for text content
 */
function generateContentHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Add intelligent sentence breaks to text for natural pacing
 */
function addSentenceBreaks(text: string): string {
  return text
    // Sentence endings: period, exclamation, question mark
    .replace(/([.!?])\s+/g, '$1<break time="0.3s"/> ')
    // Commas, semicolons, colons
    .replace(/([,;:])\s+/g, '$1<break time="0.15s"/> ')
    // Em dashes (often used for emphasis or asides)
    .replace(/\s*—\s*/g, ' <break time="0.2s"/> ')
    // Handle ellipsis
    .replace(/\.\.\.\s*/g, '...<break time="0.4s"/> ');
}

/**
 * Check if text contains nested list indicators (for proper pause handling)
 */
function hasNestedContent(text: string): boolean {
  // Check if text has multiple line breaks or nested structure indicators
  return text.includes('\n') || text.split('•').length > 2;
}

/**
 * Convert audio block to SSML markup for expressive narration
 */
function blockToSsml(block: AudioBlock): string {
  let ssml = '';
  
  switch (block.type) {
    case 'heading':
      // Headings get strong emphasis and longer pauses
      const emphasisLevel = (block.level === 1) ? 'strong' : 'moderate';
      const pauseTime = (block.level === 1) ? '0.8s' : 
                       (block.level === 2) ? '0.6s' : '0.5s';
      ssml = `<emphasis level="${emphasisLevel}">${block.textContent}</emphasis><break time="${pauseTime}"/>`;
      break;
    
    case 'blockquote':
      // Quotes get slight pitch change and surrounding pauses for distinction
      ssml = `<break time="0.4s"/><prosody pitch="-5%">${block.textContent}</prosody><break time="0.4s"/>`;
      break;
    
    case 'listItem':
      // List items get intro pause and moderate end pause
      // If list item has nested content, add longer pause after for separation
      const hasNested = hasNestedContent(block.textContent);
      const endPause = hasNested ? '0.5s' : '0.3s';
      
      // Process text: add sentence breaks and handle nested structure
      let processedText = block.textContent;
      
      // If text looks like multiple concatenated statements without punctuation,
      // treat capital letters as new sentence starts
      if (processedText.match(/[a-z][A-Z]/) && !processedText.includes('. ')) {
        // Add periods before capital letters that follow lowercase (missing sentence boundaries)
        processedText = processedText.replace(/([a-z])([A-Z])/g, '$1. $2');
      }
      
      // Add sentence breaks and handle nested bullets
      processedText = addSentenceBreaks(processedText)
        .replace(/\s*•\s*/g, '<break time="0.25s"/> ');
      
      ssml = `<break time="0.15s"/>${processedText}<break time="${endPause}"/>`;
      break;
    
    case 'paragraph':
      // Paragraphs get natural sentence breaks plus paragraph pause
      ssml = addSentenceBreaks(block.textContent) + '<break time="0.5s"/>';
      break;
    
    case 'codeBlock':
      // Code blocks announced simply with pauses
      ssml = `<break time="0.3s"/>Code block<break time="0.3s"/>`;
      break;
    
    default:
      // Default: add sentence breaks if text is long enough
      if (block.textContent.length > 50) {
        ssml = addSentenceBreaks(block.textContent) + '<break time="0.4s"/>';
      } else {
        ssml = block.textContent + '<break time="0.3s"/>';
      }
  }
  
  return ssml;
}

/**
 * Generate audio for a single block using ElevenLabs with SSML markup
 */
async function generateBlockAudio(
  block: AudioBlock,
  elevenLabsApiKey: string
): Promise<ArrayBuffer> {
  // Convert block to SSML for expressive narration
  const ssmlText = blockToSsml(block);
  
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: `<speak>${ssmlText}</speak>`,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,        // Balanced for accuracy and expression (was 0.4)
          similarity_boost: 0.8, // Higher to prevent word hallucinations (was 0.75)
          style: 0.3,            // Moderate style - prevents adding random words (was 0.6)
          use_speaker_boost: true
        }
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  return await response.arrayBuffer();
}

/**
 * Estimate audio duration based on word count (rough calculation)
 */
function estimateDuration(text: string): number {
  const wordCount = text.split(/\s+/).length;
  const wordsPerMinute = 150; // Average speaking rate
  return (wordCount / wordsPerMinute) * 60; // Duration in seconds
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pageId, blockIndex = null, forceRegenerate = false } = await req.json();
    
    if (!pageId) {
      throw new Error('pageId is required');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get ElevenLabs API key
    const elevenLabsApiKey = Deno.env.get('ELEVEN_LABS_API_KEY');
    if (!elevenLabsApiKey) {
      throw new Error('ELEVEN_LABS_API_KEY not found');
    }

    // Fetch page content including JSON
    const { data: page, error: pageError } = await supabase
      .from('pages')
      .select('id, title, content')
      .eq('id', pageId)
      .single();

    if (pageError || !page) {
      throw new Error('Page not found');
    }

    // Use JSON content if available, otherwise fall back to HTML
    let blocks: AudioBlock[] = [];
    
    if (page.content) {
      blocks = extractAudioBlocks(page.content);
    }

    if (blocks.length === 0) {
      throw new Error('No audio blocks found in content');
    }

    // If blockIndex is specified, generate only that block
    // Otherwise, generate all blocks
    const blocksToGenerate = blockIndex !== null 
      ? blocks.filter(b => b.index === blockIndex)
      : blocks;

    if (blocksToGenerate.length === 0) {
      throw new Error(`Block ${blockIndex} not found`);
    }

    // Process each block
    const results = [];
    let cumulativeTime = 0;

    for (const block of blocksToGenerate) {
      const contentHash = generateContentHash(block.textContent);

      // Check if this block already exists
      let existingBlock = null;
      if (!forceRegenerate) {
        const { data } = await supabase
          .from('page_audio_blocks')
          .select('*')
          .eq('page_id', pageId)
          .eq('block_index', block.index)
          .eq('content_hash', contentHash)
          .single();
        
        existingBlock = data;
      }

      if (existingBlock && existingBlock.audio_url) {
        // Use existing audio
        results.push({
          blockIndex: block.index,
          blockType: block.type,
          textContent: block.textContent,
          audioUrl: existingBlock.audio_url,
          duration: existingBlock.duration,
          startTime: existingBlock.start_time,
          endTime: existingBlock.end_time,
          cached: true
        });
        cumulativeTime = existingBlock.end_time || (cumulativeTime + existingBlock.duration);
      } else {
        // Generate new audio
        console.log(`Generating audio for block ${block.index}: ${block.textContent.substring(0, 50)}...`);
        
        const audioBlob = await generateBlockAudio(block, elevenLabsApiKey);
        const duration = estimateDuration(block.textContent);
        
        // Upload to Supabase Storage
        const fileName = `page-${pageId}-block-${block.index}-${Date.now()}.mp3`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('page-audio')
          .upload(fileName, audioBlob, {
            contentType: 'audio/mpeg',
            upsert: false
          });

        if (uploadError) {
          console.error('Storage upload error:', uploadError);
          throw new Error('Failed to upload audio to storage');
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('page-audio')
          .getPublicUrl(fileName);

        const startTime = cumulativeTime;
        const endTime = startTime + duration;
        cumulativeTime = endTime;

        // Save block info to database
        const { error: dbError } = await supabase
          .from('page_audio_blocks')
          .upsert({
            page_id: pageId,
            block_index: block.index,
            block_type: block.type,
            text_content: block.textContent,
            content_hash: contentHash,
            audio_url: urlData.publicUrl,
            duration: duration,
            start_time: startTime,
            end_time: endTime,
          }, {
            onConflict: 'page_id,block_index'
          });

        if (dbError) {
          console.error('Database error:', dbError);
          throw new Error('Failed to save block info to database');
        }

        results.push({
          blockIndex: block.index,
          blockType: block.type,
          textContent: block.textContent,
          audioUrl: urlData.publicUrl,
          duration: duration,
          startTime: startTime,
          endTime: endTime,
          cached: false
        });
      }
    }

    return new Response(
      JSON.stringify({
        pageId,
        blocks: results,
        totalBlocks: blocks.length,
        totalDuration: cumulativeTime
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

