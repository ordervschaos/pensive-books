/**
 * Audio Highlighting Hook
 * Applies highlighting to the currently playing audio block
 * and auto-scrolls to keep it visible
 */

import { useEffect } from 'react';

interface UseAudioHighlightingProps {
  currentBlockIndex: number | null;
  isPlaying: boolean;
  autoScroll?: boolean;
}

export const useAudioHighlighting = ({
  currentBlockIndex,
  isPlaying,
  autoScroll = true,
}: UseAudioHighlightingProps) => {
  useEffect(() => {
    // Remove existing highlights
    const previouslyHighlighted = document.querySelectorAll('.audio-highlighted');
    previouslyHighlighted.forEach(el => {
      el.classList.remove('audio-highlighted');
    });

    // Add highlight to current block
    if (currentBlockIndex !== null && isPlaying) {
      const currentElement = document.querySelector(`[data-audio-block="${currentBlockIndex}"]`);
      
      if (currentElement) {
        currentElement.classList.add('audio-highlighted');
        
        // Auto-scroll to highlighted element
        if (autoScroll) {
          currentElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      }
    }
  }, [currentBlockIndex, isPlaying, autoScroll]);
};

