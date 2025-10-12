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
 * Process list items into individual audio blocks
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
    if (item.type === 'listItem' && hasTextContent(item)) {
      const text = extractTextFromNode(item).trim();
      if (text) {
        blocks.push({
          index: blockIndex++,
          type: 'listItem',
          textContent: text,
        });
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
 * Generate audio for a single block using ElevenLabs
 */
async function generateBlockAudio(
  text: string,
  elevenLabsApiKey: string
): Promise<ArrayBuffer> {
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
        text: `<speak>${text}</speak>`,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
          style: 0.0,
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
      .select('id, title, html_content, content')
      .eq('id', pageId)
      .single();

    if (pageError || !page) {
      throw new Error('Page not found');
    }

    // Use JSON content if available, otherwise fall back to HTML
    let blocks: AudioBlock[] = [];
    
    if (page.content && typeof page.content === 'object') {
      blocks = extractAudioBlocks(page.content);
    } else {
      // Fallback: treat entire HTML content as a single block
      blocks = [{
        index: 0,
        type: 'paragraph',
        textContent: page.html_content || 'No content available'
      }];
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
        
        const audioBlob = await generateBlockAudio(block.textContent, elevenLabsApiKey);
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

