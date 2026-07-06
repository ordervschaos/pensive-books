import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// useLatestTaskRow — the one client-side watcher behind every AI activity.
//
// Every AI task (eval, scan, revise, scaffold, voice, page-gen, write-all) now lives in a DB row
// whose `status` marches to a terminal value, written server-side and pushed over Realtime. This
// hook is the read side: it loads the latest row matching a book (and optional filters), keeps it
// live as the server advances it, and reports when a row has gone stale — so a refresh or a second
// tab resumes the exact same loader / progress / proposal with no client-held state.
//
// Generalizes the watcher proven in BookEvaluationSection (channel + race re-check + stale
// watchdog). Consumers map the returned row → their own UI; the hook owns none of that.

export interface TaskRow {
  id: number;
  status: string;
  created_at: string;
  updated_at?: string | null;
  // task tables carry different payload columns; consumers read what they need.
  [key: string]: unknown;
}

type MatchValue = string | number | null | Array<string | number>;

interface Options {
  /** Task table to watch, e.g. "book_generations". */
  table: string;
  bookId: number;
  /** Extra equality/membership filters, e.g. { kind: ["page_write","page_revise"], target_page_id: 12 }. */
  match?: Record<string, MatchValue>;
  /** Columns to select (default "*"). */
  select?: string;
  /** Statuses that mean "still working" — arms the stale watchdog and keeps the row "live". */
  activeStatuses?: readonly string[];
  /** A row in an active status older than this (by updated_at, else created_at) is reported stale. */
  staleMs?: number;
  /** Set false to pause watching entirely (e.g. before a bookId is known). */
  enabled?: boolean;
}

const DEFAULT_STALE_MS = 10 * 60 * 1000;
// Coalesce a burst of Realtime events into a single authoritative re-read.
const REFETCH_DEBOUNCE_MS = 200;

function rowMatches(row: Record<string, unknown>, match?: Record<string, MatchValue>): boolean {
  if (!match) return true;
  for (const [col, want] of Object.entries(match)) {
    const have = row[col];
    if (Array.isArray(want)) {
      if (!want.includes(have as string | number)) return false;
    } else if (have !== want) {
      return false;
    }
  }
  return true;
}

function rowAge(row: TaskRow): number {
  const ts = row.updated_at || row.created_at;
  return Date.now() - new Date(ts).getTime();
}

export function useLatestTaskRow<T extends TaskRow = TaskRow>(opts: Options): {
  row: T | null;
  loading: boolean;
  /** True when the latest row is in an active status but hasn't advanced within staleMs (likely a dead job). */
  stale: boolean;
  /** Force a re-read from the table (e.g. right after kicking off a task). */
  refetch: () => void;
} {
  const { table, bookId, match, select = "*", activeStatuses = [], staleMs = DEFAULT_STALE_MS, enabled = true } = opts;

  const [row, setRow] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  const mounted = useRef(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Serialize match/activeStatuses so the effect re-runs when they change without needing the
  // caller to memoize the objects.
  const matchKey = JSON.stringify(match ?? null);
  const activeKey = activeStatuses.join(",");

  // Keep the newest row, applying the client-side `match` (the Realtime filter is book-scoped only,
  // since a channel filter takes a single column).
  const consider = useCallback(
    (incoming: T | null) => {
      if (!mounted.current || !incoming) return;
      if (!rowMatches(incoming, match)) return;
      setRow((prev) => {
        if (prev && prev.id !== incoming.id) {
          // A different row arrived — only replace if it's newer (a fresh task supersedes an old one).
          if (new Date(incoming.created_at).getTime() < new Date(prev.created_at).getTime()) return prev;
          return incoming;
        }
        if (!prev) return incoming;
        // Realtime can deliver a column as null when an UPDATE didn't touch it but Postgres omitted an
        // unchanged TOASTed jsonb value from the WAL (the "unchanged TOAST" gotcha — REPLICA IDENTITY FULL
        // on the source table helps but individual callers can still slip through). No writer in this app
        // intentionally nulls out a column that previously held real data, so patch any such regression
        // back in from the held row rather than letting it blank the UI.
        const merged: Record<string, unknown> = { ...incoming };
        const prevRec = prev as unknown as Record<string, unknown>;
        for (const key of Object.keys(prevRec)) {
          if (merged[key] == null && prevRec[key] != null) merged[key] = prevRec[key];
        }
        return merged as T;
      });
    },
    [match] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const refetch = useCallback(() => {
    let q = supabase.from(table).select(select).eq("book_id", bookId);
    if (match) {
      for (const [col, want] of Object.entries(match)) {
        q = want === null ? q.is(col, null) : Array.isArray(want) ? q.in(col, want) : q.eq(col, want);
      }
    }
    void q
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!mounted.current) return;
        setRow((data as unknown as T | null) ?? null);
        setLoading(false);
      });
  }, [table, bookId, select, matchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setLoading(false);
      return () => {
        mounted.current = false;
      };
    }

    setLoading(true);
    setRow(null);
    refetch();

    // A Realtime event is only a SIGNAL — re-read the authoritative row over HTTP (debounced to coalesce a
    // burst). PostgREST has no payload-size limit, so this catches the cases the payload body can't carry:
    // an oversized UPDATE that Realtime drops as an empty/413 payload (which would otherwise freeze us on the
    // last-seen status — e.g. the auto-accept loop stuck at "running"), and unchanged-TOAST null columns.
    const scheduleRefetch = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => { if (mounted.current) refetch(); }, REFETCH_DEBOUNCE_MS);
    };

    // Watch the whole book's task table; the callback narrows to our `match`. One channel covers
    // both a brand-new task (INSERT) and an advancing one (UPDATE). `consider` applies the payload
    // optimistically for instant feedback; `scheduleRefetch` reconciles against the true row right after.
    const channel = supabase
      .channel(`task_${table}_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `book_id=eq.${bookId}` },
        (payload) => { consider((payload as unknown as { new: T }).new); scheduleRefetch(); }
      )
      .subscribe();
    channelRef.current = channel;

    return () => {
      mounted.current = false;
      if (refetchTimer.current) { clearTimeout(refetchTimer.current); refetchTimer.current = null; }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, bookId, enabled, matchKey, refetch]);

  // Stale watchdog: while the latest row is in an active status, flip `stale` once it's been quiet
  // past staleMs (a dead self-chain / background job that Realtime will never advance). Re-armed on
  // every row change so a freshly-advanced row resets the clock.
  useEffect(() => {
    if (staleTimer.current) {
      clearTimeout(staleTimer.current);
      staleTimer.current = null;
    }
    setStale(false);
    if (!row || !activeStatuses.includes(row.status)) return;
    const remaining = staleMs - rowAge(row);
    if (remaining <= 0) {
      setStale(true);
      return;
    }
    staleTimer.current = setTimeout(() => mounted.current && setStale(true), remaining);
    return () => {
      if (staleTimer.current) clearTimeout(staleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.status, row?.updated_at, activeKey, staleMs]);

  return { row, loading, stale, refetch };
}
