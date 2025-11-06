import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ContinueWritingCard } from './ContinueWritingCard';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

// Create a wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockNavigate = vi.fn();

describe('ContinueWritingCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useNavigate as any).mockReturnValue(mockNavigate);
    
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'test-user-id',
          },
        },
      },
    });
  });

  it('should render loading state initially', () => {
    // Mock delayed response to show loading state
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockImplementation(() =>
                    new Promise(() => {}) // Never resolves to keep loading state
                  ),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const { container } = render(<ContinueWritingCard />, { wrapper: createWrapper() });

    // Should show loading skeleton
    expect(container.querySelector('[class*="animate-pulse"]')).toBeInTheDocument();
  });

  it('should display last written page when available', async () => {
    const mockPage = {
      id: 123,
      title: 'Last Page Title',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      book_id: 456,
      books: {
        id: 456,
        name: 'My Book',
        subtitle: 'Book Subtitle',
        cover_url: 'https://example.com/cover.jpg',
        show_text_on_cover: false,
      },
    };

    // Create proper chainable mock for pages query
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: mockPage,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    render(<ContinueWritingCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('My Book')).toBeInTheDocument();
      expect(screen.getByText('Last Page Title')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should not render when no pages exist', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: { code: 'PGRST116' }, // Not found error
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const { container } = render(<ContinueWritingCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Component should return null when no pages exist
      expect(container.firstChild).toBeNull();
    });
  });

  it('should navigate to page when Continue writing is clicked', async () => {
    const mockPage = {
      id: 123,
      title: 'Last Page Title',
      updated_at: new Date().toISOString(),
      book_id: 456,
      books: {
        id: 456,
        name: 'My Book',
        subtitle: null,
        cover_url: null,
        show_text_on_cover: false,
      },
    };

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: mockPage,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    render(<ContinueWritingCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Continue writing')).toBeInTheDocument();
    });

    const continueButton = screen.getByText('Continue writing').closest('button');
    continueButton?.click();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/book/456/page/123?edit=true');
    });
  });

  it('should create new page when Add new page is clicked', async () => {
    const mockPage = {
      id: 123,
      title: 'Last Page Title',
      updated_at: new Date().toISOString(),
      book_id: 456,
      books: {
        id: 456,
        name: 'My Book',
        subtitle: null,
        cover_url: null,
        show_text_on_cover: false,
      },
    };

    const mockNewPage = {
      id: 789,
    };

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: mockPage,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    // Mock RPC call properly
    (supabase.rpc as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: mockNewPage,
          error: null,
        }),
      }),
    });

    render(<ContinueWritingCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('New page')).toBeInTheDocument();
    });

    const addButton = screen.getByText('New page').closest('button');
    addButton?.click();

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('create_next_page', {
        p_book_id: 456,
      });
    }, { timeout: 2000 });

    // Wait for navigation
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('should display book cover when available', async () => {
    const mockPage = {
      id: 123,
      title: 'Last Page Title',
      updated_at: new Date().toISOString(),
      book_id: 456,
      books: {
        id: 456,
        name: 'My Book',
        subtitle: null,
        cover_url: 'https://example.com/cover.jpg',
        show_text_on_cover: false,
      },
    };

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: mockPage,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    render(<ContinueWritingCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      const img = screen.getByAltText('My Book');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
    });
  });

  it('should display subtitle when available', async () => {
    const mockPage = {
      id: 123,
      title: 'Last Page Title',
      updated_at: new Date().toISOString(),
      book_id: 456,
      books: {
        id: 456,
        name: 'My Book',
        subtitle: 'Book Subtitle',
        cover_url: null,
        show_text_on_cover: false,
      },
    };

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: mockPage,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    render(<ContinueWritingCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Book Subtitle')).toBeInTheDocument();
    });
  });
});

