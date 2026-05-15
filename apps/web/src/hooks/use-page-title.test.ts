import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageTitle } from './use-page-title';

// Mock the setPageTitle utility
const mockSetPageTitle = vi.fn();

vi.mock('@/utils/pageTitle', () => {
  return {
    setPageTitle: (...args: any[]) => mockSetPageTitle(...args),
  };
});

describe('usePageTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set page title with both pageTitle and bookName', () => {
    renderHook(() => usePageTitle('Chapter 1', 'My Book'));

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 1 - My Book');
  });

  it('should not set title when pageTitle is missing', () => {
    renderHook(() => usePageTitle(undefined, 'My Book'));

    expect(mockSetPageTitle).not.toHaveBeenCalled();
  });

  it('should not set title when bookName is missing', () => {
    renderHook(() => usePageTitle('Chapter 1', undefined));

    expect(mockSetPageTitle).not.toHaveBeenCalled();
  });

  it('should not set title when both are missing', () => {
    renderHook(() => usePageTitle(undefined, undefined));

    expect(mockSetPageTitle).not.toHaveBeenCalled();
  });

  it('should update title when pageTitle changes', () => {
    const { rerender } = renderHook(
      ({ pageTitle, bookName }) => usePageTitle(pageTitle, bookName),
      { initialProps: { pageTitle: 'Chapter 1', bookName: 'My Book' } }
    );

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 1 - My Book');

    vi.clearAllMocks();

    rerender({ pageTitle: 'Chapter 2', bookName: 'My Book' });

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 2 - My Book');
  });

  it('should update title when bookName changes', () => {
    const { rerender } = renderHook(
      ({ pageTitle, bookName }) => usePageTitle(pageTitle, bookName),
      { initialProps: { pageTitle: 'Chapter 1', bookName: 'My Book' } }
    );

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 1 - My Book');

    vi.clearAllMocks();

    rerender({ pageTitle: 'Chapter 1', bookName: 'Another Book' });

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 1 - Another Book');
  });

  it('should not update title when values remain the same', () => {
    const { rerender } = renderHook(
      ({ pageTitle, bookName }) => usePageTitle(pageTitle, bookName),
      { initialProps: { pageTitle: 'Chapter 1', bookName: 'My Book' } }
    );

    expect(mockSetPageTitle).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    rerender({ pageTitle: 'Chapter 1', bookName: 'My Book' });

    expect(mockSetPageTitle).not.toHaveBeenCalled();
  });

  it('should handle empty strings', () => {
    renderHook(() => usePageTitle('', ''));

    expect(mockSetPageTitle).not.toHaveBeenCalled();
  });

  it('should handle special characters in titles', () => {
    renderHook(() => usePageTitle('Chapter 1: Introduction & Setup', 'My Book [2024]'));

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 1: Introduction & Setup - My Book [2024]');
  });

  it('should handle very long titles', () => {
    const longTitle = 'A'.repeat(200);
    const longBookName = 'B'.repeat(200);

    renderHook(() => usePageTitle(longTitle, longBookName));

    expect(mockSetPageTitle).toHaveBeenCalledWith(`${longTitle} - ${longBookName}`);
  });

  it('should handle whitespace in titles', () => {
    renderHook(() => usePageTitle('  Chapter 1  ', '  My Book  '));

    expect(mockSetPageTitle).toHaveBeenCalledWith('  Chapter 1   -   My Book  ');
  });

  it('should be called only once per render with same values', () => {
    renderHook(() => usePageTitle('Chapter 1', 'My Book'));

    expect(mockSetPageTitle).toHaveBeenCalledTimes(1);
  });

  it('should handle transition from undefined to defined', () => {
    const { rerender } = renderHook(
      ({ pageTitle, bookName }) => usePageTitle(pageTitle, bookName),
      { initialProps: { pageTitle: undefined, bookName: undefined } }
    );

    expect(mockSetPageTitle).not.toHaveBeenCalled();

    rerender({ pageTitle: 'Chapter 1', bookName: 'My Book' });

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 1 - My Book');
  });

  it('should handle transition from defined to undefined', () => {
    const { rerender } = renderHook(
      ({ pageTitle, bookName }) => usePageTitle(pageTitle, bookName),
      { initialProps: { pageTitle: 'Chapter 1', bookName: 'My Book' } }
    );

    expect(mockSetPageTitle).toHaveBeenCalledWith('Chapter 1 - My Book');

    vi.clearAllMocks();

    rerender({ pageTitle: undefined, bookName: 'My Book' });

    expect(mockSetPageTitle).not.toHaveBeenCalled();
  });

  it('should handle numeric values (coerced to strings)', () => {
    renderHook(() => usePageTitle('123' as any, '456' as any));

    expect(mockSetPageTitle).toHaveBeenCalledWith('123 - 456');
  });

  it('should format title consistently', () => {
    const testCases = [
      { page: 'Intro', book: 'Book', expected: 'Intro - Book' },
      { page: 'Chapter 1', book: 'My Book', expected: 'Chapter 1 - My Book' },
      { page: 'a', book: 'b', expected: 'a - b' },
    ];

    testCases.forEach(({ page, book, expected }, index) => {
      vi.clearAllMocks();

      renderHook(() => usePageTitle(page, book));

      expect(mockSetPageTitle).toHaveBeenCalledWith(expected);
    });
  });
});
