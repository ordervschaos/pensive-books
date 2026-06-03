// Narrative threads (foreshadowing / open loops) — client service + types.
//
// A thread is a promise the book makes and must keep. Its promise can be seeded and reinforced
// across multiple pages; its resolution can unfold across multiple pages too. Each notable moment
// is stored as a book_thread_anchors row (role='promise' | role='resolution').
//
// Threads are AI-extracted by the `scan-threads` edge function (rolling per-page Haiku loop)
// but author-editable; `author_locked` rows are never touched by an applied scan.
import { supabase } from "@/integrations/supabase/client";

export type ThreadStatus = "planned" | "open" | "closed";

// One anchor: a page where a thread's promise is planted/deepened, or where it is resolved.
export interface ThreadAnchor {
  id: number;
  page_id: number | null;
  role: "promise" | "resolution";
  sequence: number;   // ordering within thread+role (0 = first)
  note: string | null;
  word_offset: number | null;
}

// A stored thread row (book_threads) with its anchors joined.
export interface Thread {
  id: number;
  name: string;
  description: string | null;
  status: ThreadStatus;
  target_distance: number | null;
  source: "ai" | "author";
  author_locked: boolean;
  book_thread_anchors: ThreadAnchor[];
}

// One anchor event from a scan — the output unit of the rolling Haiku loop.
// Each event represents one anchor row to be inserted. isNewThread=true means a thread row
// must also be created (book_threads insert) before the anchor can be linked to it.
export interface AnchorEvent {
  threadKey: string;          // "db:42" for existing, "new:0" for newly discovered
  threadName: string;
  threadDescription: string;
  role: "promise" | "resolution";
  pageId: number;
  wordOffset: number;
  sequence: number;           // server-computed: nth anchor of this role for this thread
  note: string;
  isNewThread: boolean;
}

export interface ThreadScan {
  summary: string;
  events: AnchorEvent[];
  scanId?: number | null;
}

const THREAD_SELECT =
  "id, name, description, status, target_distance, source, author_locked, " +
  "book_thread_anchors(id, page_id, role, sequence, note, word_offset)";

/** Convenience: first promise anchor (lowest sequence). */
export function firstPromise(t: Thread): ThreadAnchor | null {
  return (
    t.book_thread_anchors
      .filter((a) => a.role === "promise")
      .sort((a, b) => a.sequence - b.sequence)[0] ?? null
  );
}

/** Convenience: last resolution anchor (highest sequence). */
export function lastResolution(t: Thread): ThreadAnchor | null {
  return (
    t.book_thread_anchors
      .filter((a) => a.role === "resolution")
      .sort((a, b) => b.sequence - a.sequence)[0] ?? null
  );
}

/** Current threads for a book, sorted by first promise word offset (unanchored first). */
export async function fetchThreads(bookId: number): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("book_threads")
    .select(THREAD_SELECT)
    .eq("book_id", bookId);
  if (error) throw error;
  const threads = (data as unknown as Thread[] | null) ?? [];
  return threads.sort((a, b) => {
    const ao = firstPromise(a)?.word_offset ?? null;
    const bo = firstPromise(b)?.word_offset ?? null;
    if (ao === null && bo === null) return 0;
    if (ao === null) return -1; // unanchored threads listed first
    if (bo === null) return 1;
    return ao - bo;
  });
}

/** Run the explicit scan pass — returns a reviewable event list. `notify` opts the
 *  author into an email when it lands (set on the persisted scan row at insert). */
export async function scanThreads(bookId: number, notify = false): Promise<ThreadScan> {
  const { data, error } = await supabase.functions.invoke("scan-threads", { body: { bookId, notify } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const body = await ctx.json();
        if (body?.error) throw new Error(body.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw error;
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as ThreadScan;
}

/**
 * Resume a pending scan from the last persisted book_thread_scans row. The events field is
 * stored in the `changes` JSONB column. Old-format rows (pre-anchor model) will produce an
 * empty event list and the author can dismiss them cleanly.
 */
export async function fetchPendingScan(bookId: number): Promise<ThreadScan | null> {
  const { data, error } = await supabase
    .from("book_thread_scans")
    .select("id, status, summary, changes")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "pending_review") return null;
  // Validate shape: AnchorEvent has `role`; old ThreadChange has `action`. Discard old format.
  const raw = (data.changes as unknown[]) ?? [];
  const isNewFormat = raw.length === 0 || ("role" in (raw[0] as object));
  return {
    scanId: data.id as number,
    summary: (data.summary as string | null) ?? "",
    events: isNewFormat ? (raw as AnchorEvent[]) : [],
  };
}

/** Mark a persisted scan row as consumed: 'applied' or 'dismissed'. */
export async function markScanReviewed(scanId: number, status: "applied" | "dismissed"): Promise<void> {
  const { error } = await supabase.from("book_thread_scans").update({ status }).eq("id", scanId);
  if (error) throw error;
}

/**
 * Apply accepted anchor events to the database.
 * - For events with isNewThread=true: a book_threads row is inserted (using the name/description
 *   from the first accepted event for that threadKey).
 * - For all accepted events: a book_thread_anchors row is inserted.
 * Author-locked threads are guarded server-side by RLS; we don't filter them here.
 */
export async function applyThreadScan(bookId: number, accepted: AnchorEvent[]): Promise<void> {
  if (accepted.length === 0) return;

  // Collect distinct new-thread keys among accepted events (in order of first appearance).
  const newKeys: string[] = [];
  const seenNewKeys = new Set<string>();
  for (const e of accepted) {
    if (e.threadKey.startsWith("new:") && !seenNewKeys.has(e.threadKey)) {
      seenNewKeys.add(e.threadKey);
      newKeys.push(e.threadKey);
    }
  }

  // Insert new thread rows, mapping tempKey → real DB id.
  const keyToId = new Map<string, number>();
  for (const key of newKeys) {
    // Name/description come from the first accepted event for this key (the isNewThread event).
    const src = accepted.find((e) => e.threadKey === key)!;
    const { data, error } = await supabase
      .from("book_threads")
      .insert({
        book_id: bookId,
        name: src.threadName,
        description: src.threadDescription || null,
        status: "open",
        source: "ai",
        author_locked: false,
      })
      .select("id")
      .single();
    if (error) throw error;
    keyToId.set(key, (data as { id: number }).id);
  }

  // Build anchor rows.
  const anchorRows = accepted
    .map((e) => {
      const threadId = e.threadKey.startsWith("new:")
        ? keyToId.get(e.threadKey)
        : parseInt(e.threadKey.replace("db:", ""), 10);
      if (!threadId) return null;
      return {
        thread_id: threadId,
        page_id: e.pageId,
        role: e.role,
        sequence: e.sequence,
        note: e.note || null,
        word_offset: e.wordOffset,
      };
    })
    .filter(Boolean);

  if (anchorRows.length > 0) {
    const { error } = await supabase.from("book_thread_anchors").insert(anchorRows);
    if (error) throw error;
  }
}

// The author-editable fields of a thread. Anchors are the scan's job; a hand-made thread
// starts unanchored and a later scan (if unlocked) can add anchors to it.
export interface ThreadDraft {
  name: string;
  description: string;
  status: ThreadStatus;
  target_distance: number | null;
}

/** Create a thread by hand. Marked source 'author' and locked so scans won't clobber it. */
export async function createThread(bookId: number, draft: ThreadDraft): Promise<Thread> {
  const { data, error } = await supabase
    .from("book_threads")
    .insert({
      book_id: bookId,
      name: draft.name,
      description: draft.description || null,
      status: draft.status,
      target_distance: draft.target_distance,
      source: "author",
      author_locked: true,
    })
    .select(THREAD_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as Thread;
}

/** Edit a thread's author-owned fields (name / description / status / budget). */
export async function updateThread(id: number, draft: ThreadDraft): Promise<void> {
  const { error } = await supabase
    .from("book_threads")
    .update({
      name: draft.name,
      description: draft.description || null,
      status: draft.status,
      target_distance: draft.target_distance,
    })
    .eq("id", id);
  if (error) throw error;
}

/** Toggle the author-lock. Locked rows are skipped by the rolling scan. */
export async function setThreadLocked(id: number, locked: boolean): Promise<void> {
  const { error } = await supabase.from("book_threads").update({ author_locked: locked }).eq("id", id);
  if (error) throw error;
}

export async function deleteThread(id: number): Promise<void> {
  const { error } = await supabase.from("book_threads").delete().eq("id", id);
  if (error) throw error;
}

/** Format a word distance compactly: 7300 → "7.3k", 850 → "850". */
export function formatWords(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}
