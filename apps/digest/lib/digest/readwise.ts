// The Readwise client. Nothing above this file knows Readwise's HTTP shape; nothing in it knows about
// digests, sections or items — the adapter is the seam between the two (anti-corruption layer).
//
// Readwise is a highlights vault: everything you underline on a Kindle, in Reader, or in an app that
// syncs there. Two ways to draw quotes out of it, and they answer different questions:
//
//   review  — GET /api/v2/review/ . Readwise's OWN spaced-repetition pick for today. One request, and the
//             selection is the product you're already paying for, so we don't second-guess it.
//   random  — books LIST → one random page of one random book's highlights. Our own resurfacer, for when
//             you want quotes on the digest's cadence rather than Readwise's, or want them from a
//             category ("books", not tweets).
//
// NOTE ON ACCESS: the v2 API is a paid-plan feature. A free/expired account can still see a token on the
// access-token page but calls come back 401/403, which is why the settings page verifies before saving —
// a broken key must fail at paste time, in front of a human, not at 6am inside a cron job.

const API = "https://readwise.io/api/v2";
const TIMEOUT_MS = 20_000;

/** One highlight, flattened. Readwise nests book metadata differently per endpoint; callers see this. */
export interface Highlight {
  id: number;
  text: string;
  note?: string;
  /** The book/article the highlight came from. */
  title?: string;
  author?: string;
  /** Stable permalink to this highlight in Readwise. Doubles as the dedupe identity downstream. */
  url: string;
  /** When the reader highlighted it — usually years ago, which is the whole point of resurfacing. */
  highlighted_at?: string;
}

export type ReadwiseCategory = "books" | "articles" | "tweets" | "podcasts";

// Documented format of `readwise_url`. The review endpoint doesn't return that field (only `id`), so it is
// reconstructed rather than branched on — one identity for a highlight no matter which endpoint found it,
// which is what lets the dedupe layer work across modes.
const permalink = (id: number) => `https://readwise.io/open/${id}`;

class ReadwiseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Rate limits are 240/min in general but 20/min for the two LIST endpoints, and Readwise tells you exactly
// how long to wait. One honest retry: a digest that gives up on a 429 loses the morning, and a digest that
// retries forever holds a serverless function open.
async function api<T>(token: string, path: string, signal?: AbortSignal, retried = false): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Token ${token}` },
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 429 && !retried) {
    const wait = Math.min(Number(res.headers.get("Retry-After") ?? 5), 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return api<T>(token, path, signal, true);
  }
  if (!res.ok) {
    throw new ReadwiseError(
      res.status,
      res.status === 401 || res.status === 403
        ? "Readwise rejected the token (the v2 API needs an active paid plan)"
        : `Readwise ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

/** 204 = this token is live. The one call the settings page makes before it will store anything. */
export async function verifyToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API}/auth/`, {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 204) return { ok: true };
    if (res.status === 401 || res.status === 403)
      return { ok: false, error: "Readwise rejected that token. The API is a paid-plan feature — check your plan, then re-copy the token." };
    return { ok: false, error: `Readwise replied ${res.status} ${res.statusText}.` };
  } catch (e) {
    return { ok: false, error: `Could not reach Readwise: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------------------------------
// review — Readwise's own daily selection
// ---------------------------------------------------------------------------------------------------
// Deliberately does NOT call /review/complete/. Marking the review done is a write into the reader's own
// Readwise account, and a digest preview would then silently burn the review they were going to read in
// the app. Readwise rolls the set over daily on its own; our dedupe layer handles the overlap.
interface ReviewResponse {
  highlights: Array<{
    id: number;
    text: string;
    note?: string | null;
    title?: string | null;
    author?: string | null;
    highlighted_at?: string | null;
  }>;
}

export async function dailyReview(token: string, signal?: AbortSignal): Promise<Highlight[]> {
  const data = await api<ReviewResponse>(token, "/review/", signal);
  return (data.highlights ?? []).map((h) => ({
    id: h.id,
    text: h.text ?? "",
    note: h.note || undefined,
    title: h.title || undefined,
    author: h.author || undefined,
    url: permalink(h.id),
    highlighted_at: h.highlighted_at || undefined,
  }));
}

// ---------------------------------------------------------------------------------------------------
// random — our own resurfacer
// ---------------------------------------------------------------------------------------------------
// The naive version exports the whole library and picks from it: correct, and pointlessly expensive for a
// vault with tens of thousands of highlights. Instead: one books LIST (which carries num_highlights), pick
// books weighted BY that count — so the draw is uniform over highlights, not over books, and a book you
// underlined 108 times isn't as likely to come up as one you underlined twice — then read a single random
// PAGE of each chosen book's highlights. Cost is 1 + N requests regardless of library size.
interface BooksResponse {
  results: Array<{ id: number; title: string; author: string | null; num_highlights: number; category: string }>;
}
interface HighlightsResponse {
  results: Array<{ id: number; text: string; note: string | null; highlighted_at: string | null }>;
}

const PAGE = 20;

export async function randomHighlights(
  token: string,
  opts: { count: number; category?: ReadwiseCategory; signal?: AbortSignal },
): Promise<Highlight[]> {
  const q = new URLSearchParams({ page_size: "1000" });
  if (opts.category) q.set("category", opts.category);
  const { results: books } = await api<BooksResponse>(token, `/books/?${q}`, opts.signal);

  const pool = (books ?? []).filter((b) => b.num_highlights > 0);
  if (!pool.length) return [];

  // Draw distinct books, weighted by highlight count. Distinct because two quotes from the same book on the
  // same morning reads as a glitch, not as variety.
  const picks: typeof pool = [];
  const remaining = [...pool];
  for (let i = 0; i < opts.count && remaining.length; i++) {
    const total = remaining.reduce((n, b) => n + b.num_highlights, 0);
    let r = Math.random() * total;
    const idx = remaining.findIndex((b) => (r -= b.num_highlights) <= 0);
    picks.push(...remaining.splice(idx === -1 ? remaining.length - 1 : idx, 1));
  }

  const perBook = await Promise.all(
    picks.map(async (book) => {
      try {
        const pages = Math.max(1, Math.ceil(book.num_highlights / PAGE));
        const page = 1 + Math.floor(Math.random() * pages);
        const { results } = await api<HighlightsResponse>(
          token,
          `/highlights/?book_id=${book.id}&page_size=${PAGE}&page=${page}`,
          opts.signal,
        );
        return (results ?? []).map(
          (h): Highlight => ({
            id: h.id,
            text: h.text ?? "",
            note: h.note || undefined,
            title: book.title,
            author: book.author ?? undefined,
            url: permalink(h.id),
            highlighted_at: h.highlighted_at ?? undefined,
          }),
        );
      } catch (e) {
        console.error(`readwise: book ${book.id} failed:`, e);
        return []; // one unreadable book must not empty the section
      }
    }),
  );

  // Hand back every candidate, shuffled. The caller drops what it has already delivered and then cuts to
  // size — filtering here would mean this file had to know what "seen" means.
  return shuffle(perBook.flat());
}

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
