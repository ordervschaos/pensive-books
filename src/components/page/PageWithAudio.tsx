/**
 * PageWithAudio Wrapper
 * Manages audio playback state and highlighting for a page
 */

import { ReactNode } from 'react';
import { useAdaptiveTextToSpeech } from '@/hooks/use-adaptive-text-to-speech';
import { useAudioHighlighting } from '@/hooks/use-audio-highlighting';

interface PageWithAudioProps {
  pageId: string | undefined;
  content: string;
  jsonContent?: any;
  children: (audioState: ReturnType<typeof useAdaptiveTextToSpeech>) => ReactNode;
}

export const PageWithAudio = ({
  pageId,
  content,
  jsonContent,
  children
}: PageWithAudioProps) => {
  const audioState = useAdaptiveTextToSpeech({
    pageId: pageId ? parseInt(pageId) : undefined,
    content,
    jsonContent,
  });

  // Apply audio highlighting
  useAudioHighlighting({
    currentBlockIndex: audioState.currentBlockIndex,
    isPlaying: audioState.isPlaying,
    autoScroll: true,
  });

  return <>{children(audioState)}</>;
};

