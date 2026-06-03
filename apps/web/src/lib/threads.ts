// Narrative threads (foreshadowing / open loops) — client service + types.
//
// A thread is a promise the book makes and must keep: a setup that wants a payoff. Distance is
// measured in words (setup_word_offset → payoff_word_offset). Threads are AI-extracted by the
// `scan-threads` edge function (which RETURNS a reviewable diff — see ThreadScan) but
// author-editable; `author_locked` rows are never touched by an applied scan.
import { supabase } from "@/integrations/supabase/client";

export type ThreadStatus = "planned" | "open" | "closed";

// A stored thread row (book_threads).
export interface Thread {
  id: number;
  name: string;
  description: string | null;
  status: ThreadStatus;
  setup_page_id: number | null;
  setup_word_offset: number | null;
  payoff_page_id: number | null;
  payoff_word_offset: number | null;
  target_distance: number | null;
  source: "ai" | "author";
  author_locked: boolean;
}

// One proposed change in a scan diff — the contract returned by scan-threads. The model picks
// page anchors + semantics; the server resolves the *WordOffset/distance fields.
export interface ThreadChange {
  action: "new" | "advance" | "close" | "update";
  threadId: number | null;
  name: string;
  description: string;
  status: ThreadStatus;
  setupPageId: number | null;
  payoffPageId: number | null;
  why: string;
  setupWordOffset: number | null;
  payoffWordOffset: number | null;
  distance: number | null;
}
export interface ThreadScan {
  summary: string;
  changes: ThreadChange[];
  // Id of the persisted book_thread_scans row this diff lives in. Present on a fresh scan and on a
  // resumed (pending_review) scan; used to mark the row applied/dismissed once the author acts.
  scanId?: number | null;
}

const THREAD_COLS =
  "id, name, description, status, setup_page_id, setup_word_offset, payoff_page_id, payoff_word_offset, target_distance, source, author_locked";

/** Current threads for a book, ordered by where they're set up (planned/unseeded first). */
export async function fetchThreads(bookId: number): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("book_threads")
    .select(THREAD_COLS)
    .eq("book_id", bookId)
    .order("setup_word_offset", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data as Thread[] | null) ?? [];
}

/** Run the explicit scan pass — returns a reviewable diff; writes nothing. */
export async function scanThreads(bookId: number): Promise<ThreadScan> {
  const { data, error } = await supabase.functions.invoke("scan-threads", { body: { bookId } });
  if (error) {
    // Surface the function's own { error } body when present (mirrors BookEvaluationSection).
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
 * The latest scan still awaiting review (book_thread_scans, status pending_review), or null. Lets
 * the panel resume an expensive scan after a refresh instead of discarding it. The newest scan row
 * wins: if it's already applied/dismissed, there is nothing to resume.
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
  return {
    scanId: data.id as number,
    summary: (data.summary as string | null) ?? "",
    changes: (data.changes as ThreadChange[] | null) ?? [],
  };
}

/** Mark a persisted scan as consumed: 'applied' once changes are written, 'dismissed' on cancel. */
export async function markScanReviewed(scanId: number, status: "applied" | "dismissed"): Promise<void> {
  const { error } = await supabase.from("book_thread_scans").update({ status }).eq("id", scanId);
  if (error) throw error;
}

/**
 * Apply the accepted changes from a scan to book_threads. New threads (threadId == null) are
 * inserted; existing ones are updated. Updates are guarded by author_locked = false so a locked
 * row is never modified even if a stale change slips through.
 */
export async function applyThreadScan(bookId: number, accepted: ThreadChange[]): Promise<void> {
  const inserts = accepted
    .filter((c) => c.threadId == null)
    .map((c) => ({
      book_id: bookId,
      name: c.name,
      description: c.description || null,
      status: c.status,
      source: "ai",
      setup_page_id: c.setupPageId,
      setup_word_offset: c.setupWordOffset,
      payoff_page_id: c.payoffPageId,
      payoff_word_offset: c.payoffWordOffset,
    }));
  if (inserts.length) {
    const { error } = await supabase.from("book_threads").insert(inserts);
    if (error) throw error;
  }

  for (const c of accepted) {
    if (c.threadId == null) continue;
    const { error } = await supabase
      .from("book_threads")
      .update({
        name: c.name,
        description: c.description || null,
        status: c.status,
        setup_page_id: c.setupPageId,
        setup_word_offset: c.setupWordOffset,
        payoff_page_id: c.payoffPageId,
        payoff_word_offset: c.payoffWordOffset,
      })
      .eq("id", c.threadId)
      .eq("author_locked", false);
    if (error) throw error;
  }
}

// The author-editable fields of a thread. Page anchors / word offsets stay the scan's job
// (it resolves them server-side from page ids); a hand-made thread starts unanchored and a
// later scan can advance or close it.
export interface ThreadDraft {
  name: string;
  description: string;
  status: ThreadStatus;
  target_distance: number | null;
}

/** Create a thread by hand. Marked source 'author' and locked so a scan won't clobber it. */
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
    .select(THREAD_COLS)
    .single();
  if (error) throw error;
  return data as Thread;
}

/** Edit a thread's author-owned fields in place (name/description/status/budget). */
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

/** Toggle the author-lock on a thread (locked rows are protected from applied scans). */
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
