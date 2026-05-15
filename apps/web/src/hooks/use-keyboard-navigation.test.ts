import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardNavigation } from './use-keyboard-navigation';

describe('useKeyboardNavigation', () => {
  const mockHandlers = {
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onEscape: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call onNext when ArrowRight is pressed', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, false));

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    window.dispatchEvent(event);

    expect(mockHandlers.onNext).toHaveBeenCalledTimes(1);
  });

  it('should call onPrev when ArrowLeft is pressed', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, false));

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    window.dispatchEvent(event);

    expect(mockHandlers.onPrev).toHaveBeenCalledTimes(1);
  });

  it('should call onEscape when Escape is pressed', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, false));

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(event);

    expect(mockHandlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it('should not handle keys when isEditing is true', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    window.dispatchEvent(event);

    expect(mockHandlers.onNext).not.toHaveBeenCalled();
  });

  it('should not handle keys when target is an input element', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, false));

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    input.dispatchEvent(event);

    expect(mockHandlers.onNext).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('should not handle keys when target is a textarea element', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, false));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    textarea.dispatchEvent(event);

    expect(mockHandlers.onNext).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('should not handle keys when target is contentEditable', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, false));

    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    div.dispatchEvent(event);

    expect(mockHandlers.onNext).not.toHaveBeenCalled();

    document.body.removeChild(div);
  });

  it('should handle optional handlers gracefully', () => {
    const partialHandlers = { onNext: vi.fn() };
    renderHook(() => useKeyboardNavigation(partialHandlers, false));

    const eventLeft = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    const eventEscape = new KeyboardEvent('keydown', { key: 'Escape' });

    expect(() => {
      window.dispatchEvent(eventLeft);
      window.dispatchEvent(eventEscape);
    }).not.toThrow();
  });

  it('should cleanup event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useKeyboardNavigation(mockHandlers, false));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should ignore unrelated keys', () => {
    renderHook(() => useKeyboardNavigation(mockHandlers, false));

    const events = [
      new KeyboardEvent('keydown', { key: 'a' }),
      new KeyboardEvent('keydown', { key: 'Enter' }),
      new KeyboardEvent('keydown', { key: 'Space' }),
    ];

    events.forEach(event => window.dispatchEvent(event));

    expect(mockHandlers.onNext).not.toHaveBeenCalled();
    expect(mockHandlers.onPrev).not.toHaveBeenCalled();
    expect(mockHandlers.onEscape).not.toHaveBeenCalled();
  });

  it('should re-register listener when isEditing changes', () => {
    const { rerender } = renderHook(
      ({ isEditing }) => useKeyboardNavigation(mockHandlers, isEditing),
      { initialProps: { isEditing: false } }
    );

    // Should work when not editing
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(mockHandlers.onNext).toHaveBeenCalledTimes(1);

    // Change to editing mode
    rerender({ isEditing: true });

    // Should not work when editing
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(mockHandlers.onNext).toHaveBeenCalledTimes(1); // Still 1, not 2

    // Change back to non-editing
    rerender({ isEditing: false });

    // Should work again
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(mockHandlers.onNext).toHaveBeenCalledTimes(2);
  });
});
