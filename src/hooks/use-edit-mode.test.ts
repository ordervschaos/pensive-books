import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('useEditMode', () => {
  let mockSearchParams: URLSearchParams;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
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
});
