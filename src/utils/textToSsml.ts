/**
 * Text to SSML Converter
 * Adds Speech Synthesis Markup Language tags for expressive narration
 */

import { AudioBlock } from './audioBlockExtractor';

/**
 * Add intelligent sentence breaks to text
 * Inserts pauses at sentence boundaries and punctuation
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
 * Process text with inline formatting (bold, italic)
 * Note: This is a simplified version. Full implementation would parse TipTap nodes.
 */
function processInlineFormatting(text: string): string {
  // For now, text is already plain. In future, we'd parse marks from TipTap nodes
  return text;
}

/**
 * Convert an audio block to SSML markup
 * Adds appropriate emphasis, pauses, and prosody based on block type
 */
export function textToSsml(block: AudioBlock): string {
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
      ssml = `<break time="0.4s"/><prosody pitch="-5%">${processInlineFormatting(block.textContent)}</prosody><break time="0.4s"/>`;
      break;
    
    case 'listItem':
      // List items get a brief intro pause and moderate end pause
      ssml = `<break time="0.15s"/>${addSentenceBreaks(block.textContent)}<break time="0.3s"/>`;
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
 * Convert multiple blocks to SSML with proper spacing
 */
export function blocksToSsml(blocks: AudioBlock[]): string {
  return blocks.map(block => textToSsml(block)).join('');
}

/**
 * Escape special XML characters in text for SSML safety
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap SSML content in speak tags with proper formatting
 */
export function wrapInSpeakTag(ssml: string): string {
  return `<speak>${ssml}</speak>`;
}

