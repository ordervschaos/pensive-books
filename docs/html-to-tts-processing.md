# HTML to Text-to-Speech (TTS) Processing

## Overview

The audio generation system converts HTML content from pages into clean text suitable for Text-to-Speech synthesis using Eleven Labs API.

## Implementation


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

## Content Processing

**Current Implementation**: The system processes page content from the TipTap JSON structure stored in the `content` field.

### Implementation Details
1. Content is retrieved from the `content` JSON field
2. TipTap JSON is converted to HTML for processing
3. HTML is then converted to clean text for TTS
4. Content hash is generated for change detection

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

