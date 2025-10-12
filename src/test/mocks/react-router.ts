import { vi } from 'vitest';

export const mockNavigate = vi.fn();
export const mockUseParams = vi.fn(() => ({}));
export const mockUseSearchParams = vi.fn(() => [new URLSearchParams(), vi.fn()]);
export const mockUseLocation = vi.fn(() => ({
  pathname: '/',
  search: '',
  hash: '',
  state: null,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: mockUseParams,
    useSearchParams: mockUseSearchParams,
    useLocation: mockUseLocation,
  };
});
