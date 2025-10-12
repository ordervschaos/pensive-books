# Block-Based Audio with Text Highlighting

## Overview

This feature enables synchronized text highlighting during audio narration by splitting page content into audio blocks. Each paragraph, heading, or list item gets its own audio file, allowing for:

- **Fast playback start** - First block plays while others generate in background
- **Text highlighting** - Visual highlight follows narration
- **Efficient regeneration** - Only changed blocks need re-generation
- **Better seeking** - Jump to specific content blocks
- **Auto-scroll** - Page scrolls to keep highlighted text visible

## How It Works

### 1. Content Storage
- Pages now store both HTML (`html_content`) and structured JSON (`content`)
- TipTap JSON format provides clean structure for block extraction
- Backward compatible with existing HTML-only pages

### 2. Block Extraction
- Content is parsed into blocks: paragraphs, headings, list items, blockquotes
- Large paragraphs (>150 words) are split into smaller chunks
- Each block gets a unique index and content hash for change detection

### 3. Audio Generation
- New edge function: `generate-page-audio-blocks`
- Generates audio per block using ElevenLabs API
- Checks existing blocks by content hash (regenerates only changed blocks)
- Stores in `page_audio_blocks` table with timing information

### 4. Playback
- `useTextToSpeechBlocks` hook manages block-based playback
- Plays blocks sequentially, transitioning smoothly between them
- Tracks current block index for highlighting
- Supports seeking across block boundaries

### 5. Highlighting
- TipTap extension adds `data-audio-block="N"` attributes to rendered elements
- `useAudioHighlighting` hook applies CSS class to current block
- Auto-scrolls to keep highlighted block in view
- Smooth transitions with CSS animations

## Feature Flags

### Enable Block-Based Audio
```javascript
localStorage.setItem('audio_blocks_enabled', 'true');
```

### Enable Beta Features (required for audio)
```javascript
localStorage.setItem('is_beta', 'true');
```

## Database Schema

### page_audio_blocks Table
```sql
CREATE TABLE page_audio_blocks (
  id BIGSERIAL PRIMARY KEY,
  page_id INTEGER REFERENCES pages(id),
  block_index INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  text_content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  audio_url TEXT,
  duration REAL,
  start_time REAL,
  end_time REAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(page_id, block_index)
);
```

## API

### Generate Audio Blocks
```typescript
const { data } = await supabase.functions.invoke('generate-page-audio-blocks', {
  body: {
    pageId: 123,
    blockIndex: null, // null = generate all blocks
    forceRegenerate: false
  }
});
```

### Response
```typescript
{
  pageId: 123,
  blocks: [
    {
      blockIndex: 0,
      blockType: 'heading',
      textContent: 'Chapter 1: Introduction',
      audioUrl: 'https://...',
      duration: 3.5,
      startTime: 0,
      endTime: 3.5,
      cached: false
    },
    // ... more blocks
  ],
  totalBlocks: 15,
  totalDuration: 125.7
}
```

## Hooks

### useTextToSpeechBlocks
Main hook for block-based audio playback.

```typescript
const {
  isGenerating,
  isPlaying,
  error,
  duration,
  currentTime,
  playbackRate,
  currentBlockIndex, // NEW: index of currently playing block
  blocks, // NEW: array of all audio blocks
  generateAudio,
  play,
  pause,
  stop,
  seek,
  setPlaybackRate,
} = useTextToSpeechBlocks({ pageId, content });
```

### useAdaptiveTextToSpeech
Wrapper that switches between block-based and legacy audio based on feature flags.

```typescript
const audioState = useAdaptiveTextToSpeech({
  pageId,
  content, // HTML content
  jsonContent, // TipTap JSON (for block-based)
});
```

### useAudioHighlighting
Applies highlighting to currently playing block.

```typescript
useAudioHighlighting({
  currentBlockIndex,
  isPlaying,
  autoScroll: true,
});
```

## CSS

### Highlight Styling
```css
.audio-highlighted {
  background-color: rgba(255, 255, 0, 0.2);
  transition: background-color 0.3s ease;
  border-radius: 4px;
  padding: 2px 0;
}

.dark .audio-highlighted {
  background-color: rgba(255, 255, 0, 0.15);
}
```

## Files Created/Modified

### New Files
- `src/hooks/use-text-to-speech-blocks.ts` - Block-based audio hook
- `src/hooks/use-adaptive-text-to-speech.ts` - Feature flag wrapper
- `src/hooks/use-audio-highlighting.ts` - Highlighting logic
- `src/components/editor/extensions/AudioBlocks.ts` - TipTap extension
- `src/utils/audioBlockExtractor.ts` - Block extraction utility
- `supabase/functions/generate-page-audio-blocks/index.ts` - Edge function
- `supabase/migrations/20250228000001_create_page_audio_blocks.sql` - DB schema

### Modified Files
- `src/hooks/use-page-save.ts` - Save JSON content
- `src/components/editor/config/editorConfig.ts` - Add AudioBlocks extension
- `src/components/page/TextPageContent.tsx` - Integrate highlighting
- `src/components/page/FloatingActions.tsx` - Accept audio state
- `src/index.css` - Add highlight styling

## Performance

### Generation Time
- **Old System**: Wait for entire page audio (~30-60s for long pages)
- **New System**: First block ready in ~3-5s, others generate in background

### Storage
- **Old System**: 1 MP3 per page
- **New System**: Multiple MP3s per page (1 per block)
- Typical page: 10-20 blocks, ~50-200KB total

### Change Detection
- Content hash per block enables efficient regeneration
- Only modified blocks need new audio
- Unchanged blocks reuse existing audio

## Future Enhancements

1. **Sentence-level highlighting** - More granular than paragraphs
2. **Custom voice selection** - Per book or per user
3. **Playback history** - Resume from last position
4. **Offline support** - Cache audio blocks for offline playback
5. **Speed controls per block** - Slow down complex sections
6. **Translation support** - Multiple language audio tracks

## Migration Notes

- Existing pages with old audio system continue to work
- Block-based audio requires JSON content in `pages.content`
- Feature is opt-in via `audio_blocks_enabled` flag
- Can coexist with legacy audio system

