/**
 * Audio Highlighting Hook
 * Applies highlighting to the currently playing audio block,
 * adds click handlers for play-by-block,
 * and auto-scrolls to keep it visible
 */

import { useEffect } from 'react';

interface UseAudioHighlightingProps {
  currentBlockIndex: number | null;
  isPlaying: boolean;
  autoScroll?: boolean;
  onBlockClick?: (blockIndex: number) => void;
}

export const useAudioHighlighting = ({
  currentBlockIndex,
  isPlaying,
  autoScroll = true,
  onBlockClick,
}: UseAudioHighlightingProps) => {
  // Handle highlighting and scrolling
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

  // Handle click-to-play functionality
  useEffect(() => {
    if (!onBlockClick) return;

    const handleBlockClick = (event: Event) => {
      // Use event.target to get the actual clicked element
      const clickedElement = event.target as HTMLElement;

      // Find the closest element with data-audio-block attribute
      // This handles nested structures by finding the innermost block
      const targetBlock = clickedElement.closest('[data-audio-block]') as HTMLElement;

      if (targetBlock) {
        event.stopPropagation(); // Prevent bubbling to parent audio blocks

        const blockIndex = targetBlock.getAttribute('data-audio-block');

        if (blockIndex !== null) {
          const index = parseInt(blockIndex, 10);
          if (!isNaN(index)) {
            onBlockClick(index);
          }
        }
      }
    };

    // Add a single click handler to the document
    document.addEventListener('click', handleBlockClick);

    // Cleanup
    return () => {
      document.removeEventListener('click', handleBlockClick);
    };
  }, [onBlockClick]);
};

