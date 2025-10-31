import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditMode } from './use-edit-mode';
import * as ReactRouter from 'react-router-dom';

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useSearchParams: vi.fn(),
  };
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('useEditMode', () => {
  let mockSearchParams: URLSearchParams;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  it('should initialize with isEditing=false', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(false);
  });

  it('should enable editing when ?edit=true and canEdit=true', () => {
    mockSearchParams.set('edit', 'true');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(true);
  });

  it('should not enable editing when ?edit=true but canEdit=false', () => {
    mockSearchParams.set('edit', 'true');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(false));

    expect(result.current[0]).toBe(false);
  });

  it('should not enable editing when ?edit=false', () => {
    mockSearchParams.set('edit', 'false');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(false);
  });

  it('should not enable editing when edit param is missing', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(false);
  });

  it('should return setter function', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(typeof result.current[1]).toBe('function');
  });

  it('should allow manual toggling of edit mode', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(false);

    // Manually set editing to true using act
    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
  });

  it('should update when searchParams change', () => {
    const initialParams = new URLSearchParams();
    (ReactRouter.useSearchParams as any).mockReturnValue([initialParams]);

    const { result, rerender } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(false);

    // Simulate URL change with edit=true
    const newParams = new URLSearchParams();
    newParams.set('edit', 'true');
    (ReactRouter.useSearchParams as any).mockReturnValue([newParams]);

    rerender();

    expect(result.current[0]).toBe(true);
  });

  it('should update when canEdit permission changes', () => {
    mockSearchParams.set('edit', 'true');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result, rerender } = renderHook(
      ({ canEdit }) => useEditMode(canEdit),
      { initialProps: { canEdit: false } }
    );

    expect(result.current[0]).toBe(false);

    // Grant edit permission
    rerender({ canEdit: true });

    expect(result.current[0]).toBe(true);
  });

  it('should handle various edit param values', () => {
    const testCases = [
      { param: 'true', canEdit: true, expected: true },
      { param: 'TRUE', canEdit: true, expected: false },
      { param: '1', canEdit: true, expected: false },
      { param: 'yes', canEdit: true, expected: false },
      { param: '', canEdit: true, expected: false },
    ];

    testCases.forEach(({ param, canEdit, expected }) => {
      mockSearchParams = new URLSearchParams();
      if (param) mockSearchParams.set('edit', param);
      (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

      const { result } = renderHook(() => useEditMode(canEdit));

      expect(result.current[0]).toBe(expected);
    });
  });

  it('should preserve other URL parameters', () => {
    mockSearchParams.set('edit', 'true');
    mockSearchParams.set('tab', 'history');
    mockSearchParams.set('filter', 'recent');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(true);
    expect(mockSearchParams.get('tab')).toBe('history');
    expect(mockSearchParams.get('filter')).toBe('recent');
  });

  it('should return tuple with correct types', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    const [isEditing, setIsEditing] = result.current;

    expect(typeof isEditing).toBe('boolean');
    expect(typeof setIsEditing).toBe('function');
  });

  it('should initialize from localStorage when no URL param', () => {
    localStorageMock.setItem('pensive_edit_mode', 'true');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(true);
  });

  it('should save to localStorage when manually toggling edit mode', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(false);
    expect(localStorageMock.getItem('pensive_edit_mode')).toBeNull();

    // Manually set editing to true
    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(localStorageMock.getItem('pensive_edit_mode')).toBe('true');
  });

  it('should save to localStorage when URL param changes edit mode', () => {
    mockSearchParams.set('edit', 'true');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(true);
    expect(localStorageMock.getItem('pensive_edit_mode')).toBe('true');
  });

  it('should persist edit mode across hook remounts', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    // First render - set edit mode to true
    const { result: result1, unmount } = renderHook(() => useEditMode(true));
    act(() => {
      result1.current[1](true);
    });

    expect(result1.current[0]).toBe(true);
    expect(localStorageMock.getItem('pensive_edit_mode')).toBe('true');

    // Unmount and remount
    unmount();

    // Second render - should restore from localStorage
    const { result: result2 } = renderHook(() => useEditMode(true));
    expect(result2.current[0]).toBe(true);
  });

  it('should use URL param over localStorage when both present', () => {
    localStorageMock.setItem('pensive_edit_mode', 'true');
    mockSearchParams.set('edit', 'false');
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    // URL param should take priority
    expect(result.current[0]).toBe(false);
    // And localStorage should be updated to match
    expect(localStorageMock.getItem('pensive_edit_mode')).toBe('false');
  });

  it('should support functional setter updates', () => {
    (ReactRouter.useSearchParams as any).mockReturnValue([mockSearchParams]);

    const { result } = renderHook(() => useEditMode(true));

    expect(result.current[0]).toBe(false);

    // Use functional setter
    act(() => {
      result.current[1](prev => !prev);
    });

    expect(result.current[0]).toBe(true);
    expect(localStorageMock.getItem('pensive_edit_mode')).toBe('true');
  });
});
