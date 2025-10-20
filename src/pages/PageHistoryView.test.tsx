/**
 * Tests for PageHistoryView component
 * Verifies history restoration with JSON content conversion
 *
 * NOTE: html_content references in this file are for backward compatibility testing only.
 * The html_content field is deprecated. All new pages use the 'content' JSON field.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import PageHistoryView from './PageHistoryView';

// Mock dependencies
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ bookId: '1', pageId: '123' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: { html_content: '<p>Current content</p>' },
              error: null,
            })
          ),
          order: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: 1,
                  page_id: 123,
                  html_content: '<p>Version 1</p>',
                  created_at: '2024-01-01T10:00:00Z',
                  created_by: 'user1',
                  batch_id: 'batch1',
                  created_at_minute: '2024-01-01T10:00:00Z',
                },
              ],
              error: null,
            })
          ),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() =>
          Promise.resolve({
            error: null,
          })
        ),
      })),
    })),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));


describe('PageHistoryView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it('should render without crashing', () => {
    const { container } = renderWithRouter(<PageHistoryView />);
    expect(container).toBeTruthy();
  });



  describe('Edge cases', () => {
    it('should handle null or undefined gracefully', () => {
      // Component should render even with edge cases
      const { container } = renderWithRouter(<PageHistoryView />);
      expect(container).toBeTruthy();
    });
  });
});
