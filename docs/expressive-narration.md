# Expressive Audio Narration

## Overview

Enhanced text-to-speech narration with SSML (Speech Synthesis Markup Language) markup for natural, expressive audio. Adds appropriate emphasis, pauses, and prosody based on content structure and formatting.

## What Changed

### Before
- **Flat narration** - All text read in monotone
- **No pauses** - Sentences run together
- **Same emphasis** - Headings sound like paragraphs
- **Fast pacing** - No breathing room between sections

### After
✅ **Expressive narration** - Natural tone variation
✅ **Intelligent pauses** - Breaks at sentences, commas, sections
✅ **Emphasis on headings** - Important titles stand out
✅ **Quotes distinguished** - Slight pitch change for quoted text
✅ **Better pacing** - Comfortable listening speed

## SSML Markup Applied

### By Content Type

| Content Type | Treatment | Example Output |
|-------------|-----------|----------------|
| **H1 Heading** | Strong emphasis + 0.8s pause | "**CHAPTER ONE**" ⏸️⏸️ |
| **H2 Heading** | Moderate emphasis + 0.6s pause | "_Section Title_" ⏸️ |
| **H3 Heading** | Moderate emphasis + 0.5s pause | "_Subsection_" ⏸️ |
| **Paragraph** | Sentence breaks + 0.5s end pause | "Text here.⏸️ More text.⏸️" |
| **Blockquote** | Lower pitch + 0.4s pauses | ⏸️ "_quoted text_" ⏸️ |
| **List Item** | 0.15s intro + 0.3s end pause | "⏸️ Item one⏸️" |
| **Nested List Item** | 0.15s intro + 0.5s end pause | "⏸️ Item⏸️⏸️" (longer end pause) |
| **Code Block** | Announced briefly | "⏸️ Code block⏸️" |

### Pause Durations

- **Sentence endings** (. ! ?): 0.3s
- **Commas/semicolons/colons** (, ; :): 0.15s
- **Em dashes** (—): 0.2s
- **Ellipsis** (...): 0.4s
- **After paragraphs**: 0.5s
- **After H1**: 0.8s
- **After H2-H3**: 0.5-0.6s
- **Before/after quotes**: 0.4s
- **Before list items**: 0.15s
- **After list items**: 0.3s (0.5s if nested content)
- **Between nested bullets**: 0.25s

## Voice Settings

### ElevenLabs Configuration

```typescript
voice_settings: {
  stability: 0.5,        // Balanced for accuracy and expression
  similarity_boost: 0.8, // High to prevent word hallucinations
  style: 0.3,            // Moderate - expressive but accurate
  use_speaker_boost: true
}
```

**Key Changes:**
- **Stability**: 0.5 (balanced - not too creative, not too robotic)
- **Similarity Boost**: 0.5 → 0.8 (HIGH - prevents adding random words)
- **Style**: 0.0 → 0.3 (moderate expressiveness without hallucinations)

**Why These Values:**
- Higher style (>0.5) caused the AI to add words like "I" and "I am" that weren't in the source
- Lower stability (<0.5) also contributed to hallucinations
- similarity_boost at 0.8 helps maintain accuracy to the source text

## Implementation Details

### Files Created/Modified

**New Files:**
- `src/utils/textToSsml.ts` - SSML markup processor

**Modified Files:**
- `supabase/functions/generate-page-audio-blocks/index.ts` - Integrated SSML + voice settings
- `src/utils/audioBlockExtractor.ts` - Added marks and rawNode fields

### SSML Processing Flow

```
1. Block extracted from TipTap JSON
   ↓
2. Block type identified (heading, paragraph, list, etc.)
   ↓
3. Appropriate SSML markup applied
   ↓
4. Sentence breaks added for natural pacing
   ↓
5. Wrapped in <speak> tags
   ↓
6. Sent to ElevenLabs with optimized voice settings
   ↓
7. Expressive audio returned
```

### Example Transformations

#### Heading
```
Input: "Chapter 1: Introduction"
SSML: <emphasis level="strong">Chapter 1: Introduction</emphasis><break time="0.8s"/>
Result: Strong voice, prominent pause after
```

#### Paragraph
```
Input: "This is a sentence. Here's another one, with a comma."
SSML: This is a sentence.<break time="0.3s"/> Here's another one,<break time="0.15s"/> with a comma.<break time="0.5s"/>
Result: Natural pauses at punctuation, breathing room
```

#### Blockquote
```
Input: "To be or not to be"
SSML: <break time="0.4s"/><prosody pitch="-5%">To be or not to be</prosody><break time="0.4s"/>
Result: Slightly lower pitch, distinguished from regular text
```

## Testing

### How to Test

1. **Clear existing audio** (optional - to force regeneration):
   ```sql
   DELETE FROM page_audio_blocks WHERE page_id = YOUR_PAGE_ID;
   ```

2. **Generate new audio**:
   - Navigate to a page with varied content (headings, paragraphs, lists, quotes)
   - Click the audio button
   - Listen for improvements

3. **What to Listen For**:
   - ✅ Headings sound more important/emphasized
   - ✅ Natural pauses at sentences and punctuation
   - ✅ Quotes have slightly different tone
   - ✅ Overall more engaging/less robotic

### Sample Content for Testing

```markdown
# Chapter 1: The Beginning

This is the introduction. It has multiple sentences. Each one should have a natural pause.

## Section 1

Here are some key points:

- First item in the list
- Second item with emphasis
- Third item for completeness

> "The journey of a thousand miles begins with a single step." 
> — Ancient proverb

Now back to regular paragraphs, which flow naturally with appropriate pacing.
```

## Performance Impact

### Generation Time
- **No change** - SSML is processed client-side before API call
- Same API call duration
- Same storage requirements

### Audio Quality
- **Significantly better** - More natural and engaging
- **Same file size** - MP3 compression unchanged
- **Better retention** - Easier to listen to for extended periods

## Future Enhancements

### Planned
- **Inline formatting** - Bold text gets moderate emphasis
- **Italic text** - Subtle emphasis/reduced intensity
- **Code** - Announced as "code" with pauses
- **Tables** - Smart handling of tabular data

### Possible
- **Emotion detection** - Adjust tone based on content sentiment
- **Multiple voices** - Different voices for dialogue
- **Background ambience** - Subtle music during long sections
- **Speed variation** - Slow down complex explanations
- **Pronunciation dictionary** - Custom pronunciation for specialized terms

## Rollback

If needed, revert voice settings in edge function:

```typescript
voice_settings: {
  stability: 0.5,
  similarity_boost: 0.5,
  style: 0.0,
  use_speaker_boost: true
}
```

And remove SSML markup (use plain text in `<speak>` tags).

## References

- [ElevenLabs API Documentation](https://elevenlabs.io/docs)
- [SSML Specification](https://www.w3.org/TR/speech-synthesis/)
- [Block-Based Audio Documentation](./block-based-audio-highlighting.md)

