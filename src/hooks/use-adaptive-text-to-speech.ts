/**
 * Adaptive Text-to-Speech Hook
 * Switches between block-based and legacy audio systems based on feature flags
 */

import { useTextToSpeech } from './use-text-to-speech';
import { useTextToSpeechBlocks } from './use-text-to-speech-blocks';

interface UseAdaptiveTextToSpeechProps {
  pageId: number | undefined;
  content: string;
  jsonContent?: any;
}

export const useAdaptiveTextToSpeech = ({
  pageId,
  content,
  jsonContent
}: UseAdaptiveTextToSpeechProps) => {
  // Check for block-based audio feature flag
  const useBlockBasedAudio = localStorage.getItem('audio_blocks_enabled') === 'true';

  // Use block-based audio if enabled and JSON content is available
  const shouldUseBlocks = useBlockBasedAudio && jsonContent && pageId;

  const legacyAudio = useTextToSpeech({
    pageId: pageId || 0,
    content,
  });

  const blockBasedAudio = useTextToSpeechBlocks({
    pageId: pageId || 0,
    content: jsonContent,
  });

  // Return the appropriate implementation
  if (shouldUseBlocks) {
    return {
      ...blockBasedAudio,
      audioUrl: blockBasedAudio.blocks.length > 0 ? blockBasedAudio.blocks[0].audioUrl : null,
      mode: 'blocks' as const,
    };
  }

  return {
    ...legacyAudio,
    currentBlockIndex: null,
    blocks: [],
    mode: 'legacy' as const,
  };
};

