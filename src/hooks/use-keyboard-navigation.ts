import { useEffect } from 'react';

interface KeyboardNavigationHandlers {
  onNext?: () => void;
  onPrev?: () => void;
  onEscape?: () => void;
}

/**
 * Custom hook to handle keyboard shortcuts for page navigation
 * Automatically disables navigation when user is editing
 */
export const useKeyboardNavigation = (
  handlers: KeyboardNavigationHandlers,
  isEditing: boolean
) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't intercept keys when user is editing
      if (isEditing) return;

      // Don't intercept if user is typing in an input/textarea
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true'
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          handlers.onNext?.();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          handlers.onPrev?.();
          break;
        case 'Escape':
          handlers.onEscape?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers, isEditing]);
};
