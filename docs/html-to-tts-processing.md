# HTML to Text-to-Speech (TTS) Processing

## Overview

The audio generation system converts HTML content from pages into clean text suitable for Text-to-Speech synthesis using Eleven Labs API.

## Implementation

### Main Function: `processHtmlForTTS()`

Location: `supabase/functions/generate-page-audio/index.ts` and `src/utils/htmlToTtsText.ts`

The function performs the following operations:

1. **Remove Script & Style Tags**: Strips `<script>` and `<style>` tags and their contents
2. **Remove HTML Attributes**: Strips all attributes (class, id, style, etc.) from HTML tags to clean up formatting
3. **Add SSML Emphasis for Headings**: Converts heading tags to SSML emphasis tags
   - `<h1>` and `<h2>` → `<emphasis level="strong">` with 0.5s pause
   - `<h3>` and `<h4>` → `<emphasis level="moderate">` with 0.4s pause
   - `<h5>` and `<h6>` → `<emphasis level="moderate">` with 0.3s pause
4. **Add SSML Pauses**: Inserts `<break time="0.3s"/>` after:
   - Paragraphs (`</p>`)
   - Line breaks (`<br>`)
   - List items (`</li>`)
   - Blockquotes (`</blockquote>`)
5. **Strip Remaining HTML Tags**: Removes all HTML tags (but preserves their text content)
6. **Decode HTML Entities**: Converts HTML entities to their character equivalents
7. **Normalize Whitespace**: Reduces multiple spaces/newlines to single spaces and trims

### Supported HTML Entities

The function decodes common HTML entities including:
- Basic: `&amp;` `&lt;` `&gt;` `&quot;` `&nbsp;`
- Punctuation: `&ndash;` `&mdash;` `&hellip;` `&rsquo;` `&lsquo;` `&rdquo;` `&ldquo;`
- Symbols: `&copy;` `&reg;` `&trade;` `&euro;` `&pound;` `&yen;` `&cent;`
- French accents: `&eacute;` `&egrave;` `&ecirc;` `&agrave;` `&acirc;` `&ccedil;`
- Numeric entities: `&#8211;` (en dash), `&#x2022;` (bullet), etc.

### Tested HTML Formats

The implementation is tested against 39 different scenarios including:

#### Basic HTML Structures
- `<h1 class="text-4xl font-bold text-center">Published</h1>` → `"Published"`
- `<h2><strong>Chapitre 2 – Le Basculement</strong></h2>` → `"Chapitre 2 – Le Basculement"`
- `<h1>Untitled</h1><p></p>` → `"Untitled"`

#### Complex Content
- Multiple paragraphs
- Nested lists (ordered and unordered)
- Tables with headers and cells
- Blockquotes and code blocks
- Inline formatting (bold, italic, links, code)

#### Edge Cases
- Empty content
- Malformed HTML
- Unicode characters (Japanese, Chinese, Arabic, accented characters)
- Self-closing tags
- Multiple whitespace characters

## Testing

### Test Suite Location
`src/utils/htmlToTtsText.test.ts`

### Running Tests
```bash
npm test -- src/utils/htmlToTtsText.test.ts
```

### Test Coverage
- 39 comprehensive tests
- Covers real-world TipTap editor output
- Tests French text with special characters
- Validates various HTML structures from the editor

## Migration from `page.content`

**Previous Implementation**: The system previously used the deprecated `page.content` (TipTap JSON structure) with fallback to `html_content`.

**Current Implementation**: Now exclusively uses `html_content` for audio generation.

### Changes Made
1. Removed `content` field from database queries
2. Updated content hash generation to use only HTML
3. Simplified TTS text processing to use only HTML processing
4. Marked `processTipTapContentForTTS()` as deprecated

## Utility Function

A shared utility function is available at `src/utils/htmlToTtsText.ts` that can be used in the frontend for testing and validation purposes. The Edge Function has its own copy of this logic since it runs in a Deno environment.

## SSML (Speech Synthesis Markup Language)

The function now generates SSML-enhanced output for better text-to-speech quality:

### Emphasis Levels
- **Strong**: Used for main headings (h1, h2) to make them stand out
- **Moderate**: Used for subheadings (h3-h6) for subtle emphasis

### Pauses
- **0.5s**: After major headings (h1, h2) for clear separation
- **0.4s**: After medium headings (h3, h4)
- **0.3s**: After minor headings (h5, h6), paragraphs, list items, line breaks, and blockquotes

This creates natural-sounding speech with appropriate pacing and intonation.

## Future Improvements

Potential enhancements to consider:
1. Extract image `alt` attributes for better context
2. Handle pronunciation hints for technical terms
3. Support for custom entity definitions
4. Better handling of mathematical notation
5. Adjust speaking rate based on content type

## Related Files
- Edge Function: `supabase/functions/generate-page-audio/index.ts`
- Utility: `src/utils/htmlToTtsText.ts`
- Tests: `src/utils/htmlToTtsText.test.ts`

