import { vi } from 'vitest';

export const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  delete: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  neq: vi.fn(() => mockSupabase),
  gt: vi.fn(() => mockSupabase),
  lt: vi.fn(() => mockSupabase),
  gte: vi.fn(() => mockSupabase),
  lte: vi.fn(() => mockSupabase),
  like: vi.fn(() => mockSupabase),
  ilike: vi.fn(() => mockSupabase),
  is: vi.fn(() => mockSupabase),
  in: vi.fn(() => mockSupabase),
  contains: vi.fn(() => mockSupabase),
  containedBy: vi.fn(() => mockSupabase),
  rangeGt: vi.fn(() => mockSupabase),
  rangeLt: vi.fn(() => mockSupabase),
  rangeGte: vi.fn(() => mockSupabase),
  rangeLte: vi.fn(() => mockSupabase),
  rangeAdjacent: vi.fn(() => mockSupabase),
  overlaps: vi.fn(() => mockSupabase),
  match: vi.fn(() => mockSupabase),
  not: vi.fn(() => mockSupabase),
  or: vi.fn(() => mockSupabase),
  filter: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  limit: vi.fn(() => mockSupabase),
  range: vi.fn(() => mockSupabase),
  single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
  rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  auth: {
    getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  },
  storage: {
    from: vi.fn(() => ({
      upload: vi.fn(() => Promise.resolve({ data: null, error: null })),
      download: vi.fn(() => Promise.resolve({ data: null, error: null })),
      remove: vi.fn(() => Promise.resolve({ data: null, error: null })),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: '' } })),
    })),
  },
};

export const createMockSupabaseResponse = <T>(data: T, error: any = null) => ({
  data,
  error,
});
