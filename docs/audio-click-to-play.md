# Audio Click-to-Play Feature

## Overview

Implemented a click-to-play feature that allows users to click on any audio block to immediately jump to and play that specific section of audio narration. This enhances user experience by providing direct access to any part of the content.

## Implementation Details

### 1. CSS Styling (`src/index.css`)

**Clickable Block Styling:**
- All elements with `[data-audio-block]` attribute are now clickable
- Hover effect: subtle blue background + 2px translateX for visual feedback
- No padding/margin added to prevent layout shift (lesson learned from previous bug)
- Uses `box-shadow` instead of padding for visual effects to avoid layout reflow

**Key CSS Features:**
```css
[data-audio-block] {
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
  border-radius: 4px;
  position: relative;
}

[data-audio-block]:hover {
  background-color: rgba(59, 130, 246, 0.05);  /* Blue-500 with low opacity */
  transform: translateX(2px);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.1);
}
```

**Highlighted Block Hover Enhancement:**
- Currently playing blocks show enhanced yellow hover effect
- Maintains visual consistency while indicating interactivity

### 2. Audio Hook Updates

**`use-text-to-speech-blocks.ts`:**
- Added `playBlockByIndex(blockIndex: number)` method
- Finds the audio block matching the provided block index
- Starts playback from that specific block
- Handles case where audio hasn't been generated yet

**Key Implementation:**
```typescript
const playBlockByIndex = useCallback(async (blockIndex: number) => {
  // Find the block with matching index
  const targetBlock = blocks.find(b => b.blockIndex === blockIndex);
  if (!targetBlock) {
    console.warn(`Block with index ${blockIndex} not found`);
    return;
  }

  // Find the position in the blocks array
  const arrayIndex = blocks.indexOf(targetBlock);
  
  // Start playing from this block
  await playBlockAtIndex(arrayIndex);
}, [blocks, generateAudio, playBlockAtIndex]);
```

### 3. Audio Highlighting Hook (`use-audio-highlighting.ts`)

**New Functionality:**
- Added `onBlockClick` callback prop
- Separate `useEffect` for click handler management
- Attaches click listeners to all `[data-audio-block]` elements
- Properly cleans up event listeners on unmount
- Extracts block index from `data-audio-block` attribute and calls callback

**Architecture Decision:**
- Kept highlighting and click handling in separate `useEffect` hooks
- Better separation of concerns and easier to maintain
- Click handlers only added when `onBlockClick` is provided

### 4. Adaptive TTS Hook (`use-adaptive-text-to-speech.ts`)

**Updates:**
- Passes through `playBlockByIndex` from block-based audio
- Provides no-op fallback for legacy audio mode
- Maintains backward compatibility

### 5. Integration Points

**`TextPageContent.tsx` and `PageWithAudio.tsx`:**
- Pass `audioState.playBlockByIndex` to `useAudioHighlighting`
- Enables click-to-play functionality wherever audio highlighting is used

## User Experience Flow

1. **Page loads** → Audio blocks have `[data-audio-block]` attributes
2. **User hovers** → Block shows blue highlight + cursor pointer
3. **User clicks** → Audio jumps to that block and starts playing
4. **Playing block** → Yellow highlight with enhanced hover effect
5. **Auto-advance** → Continues to next blocks sequentially

## Technical Considerations

### Layout Shift Prevention
- **Lesson:** Adding padding/margin causes layout shift when highlighting appears
- **Solution:** Use `box-shadow` for all visual effects
- Box-shadow doesn't affect box model, so no reflow/repaint issues

### Event Listener Management
- Click listeners attached in `useEffect` with proper cleanup
- Uses `event.currentTarget` to get the clicked element (not bubbled target)
- Safely parses block index with `parseInt` and `isNaN` check

### Performance
- Event delegation considered but not used due to TipTap's dynamic DOM
- Individual listeners are fine since audio blocks are limited in number
- Cleanup prevents memory leaks

## Data Flow

```
User Click → DOM Element [data-audio-block="5"]
           ↓
useAudioHighlighting (event listener)
           ↓
audioState.playBlockByIndex(5)
           ↓
useTextToSpeechBlocks.playBlockByIndex(5)
           ↓
Find block in database results
           ↓
playBlockAtIndex(arrayIndex)
           ↓
Audio plays from that block
           ↓
useAudioHighlighting highlights block
```

## Future Enhancements

1. **Double-click to pause** - Click playing block to pause
2. **Visual block markers** - Show small speaker icon on hover
3. **Keyboard navigation** - Arrow keys to jump between blocks
4. **Progress indicator** - Show mini progress bar within each block
5. **Block preview** - Tooltip showing block text on hover
6. **Block ranges** - Click and drag to select multiple blocks

## Testing Checklist

- [x] Blocks show hover effect
- [x] Clicking block starts audio from that point
- [x] Currently playing block highlights correctly
- [x] No layout shift on highlight/hover
- [x] Works with nested lists
- [x] Works with different block types (heading, paragraph, listItem)
- [x] Event listeners properly cleaned up
- [x] Works in both light and dark mode

## Related Files

- `src/index.css` - CSS styling for clickable blocks
- `src/hooks/use-audio-highlighting.ts` - Highlighting + click handlers
- `src/hooks/use-text-to-speech-blocks.ts` - Audio playback logic
- `src/hooks/use-adaptive-text-to-speech.ts` - Adapter between modes
- `src/components/page/TextPageContent.tsx` - Integration point
- `src/components/page/PageWithAudio.tsx` - Integration point
- `src/components/editor/extensions/AudioBlocks.ts` - Adds data-audio-block attributes

## Lessons Learned

1. **Always use box-shadow for visual effects that shouldn't affect layout**
   - Never use padding/margin for highlighting
   - Box-shadow is perfect for borders/glows without reflow

2. **Separate concerns in useEffect hooks**
   - One effect for highlighting
   - One effect for click handlers
   - Easier to debug and maintain

3. **Proper event listener cleanup is crucial**
   - Always return cleanup function from useEffect
   - Prevents memory leaks and duplicate handlers

4. **Design for extensibility**
   - Made `onBlockClick` optional
   - Allows disabling feature easily
   - Backward compatible with existing code

