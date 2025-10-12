/**
 * Audio Block Extractor
 * Converts TipTap JSON content into audio-ready blocks
 */

export interface AudioBlock {
  index: number;
  type: string; // 'paragraph', 'heading', 'listItem', 'blockquote', etc.
  textContent: string;
  level?: number; // for headings
  children?: AudioBlock[]; // for nested structures like lists
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
 * Split large paragraph into smaller chunks (sentences or ~150 words)
 */
function splitLargeParagraph(text: string, startIndex: number): AudioBlock[] {
  const blocks: AudioBlock[] = [];
  const maxWords = 150;
  
  // Split by sentences (simple approach)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = '';
  let chunkIndex = startIndex;
  
  for (const sentence of sentences) {
    const words = (currentChunk + ' ' + sentence).trim().split(/\s+/);
    
    if (words.length > maxWords && currentChunk) {
      // Save current chunk and start new one
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
  
  // Add remaining chunk
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
export function extractAudioBlocks(tiptapJSON: any): AudioBlock[] {
  const blocks: AudioBlock[] = [];
  let blockIndex = 0;

  if (!tiptapJSON || !tiptapJSON.content || !Array.isArray(tiptapJSON.content)) {
    return blocks;
  }

  for (const node of tiptapJSON.content) {
    // Skip nodes without text content
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
        // Split large paragraphs
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
        // For code blocks, just mention that code is present
        blocks.push({
          index: blockIndex++,
          type: 'codeBlock',
          textContent: 'Code block',
        });
        break;

      default:
        // For other node types, just extract the text
        if (text.length > 10) { // Minimum meaningful content
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
 * Generate a simple hash for text content (for change detection)
 */
export function generateContentHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Convert audio blocks to a format suitable for the database
 */
export interface AudioBlockForDB {
  block_index: number;
  block_type: string;
  text_content: string;
  content_hash: string;
}

export function prepareBlocksForDB(blocks: AudioBlock[]): AudioBlockForDB[] {
  return blocks.map(block => ({
    block_index: block.index,
    block_type: block.type,
    text_content: block.textContent,
    content_hash: generateContentHash(block.textContent),
  }));
}

