/**
 * Convert HTML to SSML-enhanced text suitable for Text-to-Speech (TTS)
 * This function:
 * 1. Removes script and style tags
 * 2. Converts HTML structure to SSML with emphasis and pauses
 * 3. Decodes HTML entities
 * 4. Normalizes whitespace
 */
export function htmlToTtsText(html: string): string {
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
  decoded = decoded.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  
  return decoded;
}

