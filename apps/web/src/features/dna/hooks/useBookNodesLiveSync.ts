// useBookNodesLiveSync — the debounced Realtime re-fetch on `book_nodes` changes, shared by every
// page that projects the live tree (refresh = no-op, standing rule). Was hand-copied identically
// (down to the 400ms debounce) across StudioTreePage/StudioMetersPage/StudioLedgerPage, differing only by
// the channel-name prefix (which just needs to be readable in the Realtime debug view — the random
// suffix already guarantees uniqueness). Owns only the SUBSCRIPTION; callers still do their own
// initial load (it varies — StudioTreePage's bootstraps an empty tree, the others are a plain select).
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DnaNode } from "@/features/dna/lib/novelDna";

export function useBookNodesLiveSync(bookId: number, channelPrefix: string, setNodes: (nodes: DnaNode[]) => void): void {
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position")
        .then(({ data }) => { if (data) setNodes(data as DnaNode[]); }), 400);
    };
    const ch = supabase.channel(`${channelPrefix}_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_nodes", filter: `book_id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId, channelPrefix, setNodes]);
}
