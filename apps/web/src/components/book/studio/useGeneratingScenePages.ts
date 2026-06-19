// useGeneratingScenePages — the set of page ids with an in-flight scene-image render, for the
// Navigator's "generating" badge. Scene generation is durable (a 'generating' row in page_scene_images
// that the background flips to 'ready'/'error'); this watches the book's rows over Realtime so the map
// shows which pages are still working without opening each one. Re-queries on any change (low volume) so
// the set stays correct even when a page has several renders in flight.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useGeneratingScenePages(bookId: number): Set<number> {
  const [ids, setIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    const load = () => {
      void supabase
        .from("page_scene_images")
        .select("page_id")
        .eq("book_id", bookId)
        .in("status", ["composing", "generating"])
        .then(({ data }) => { if (live) setIds(new Set((data ?? []).map((r) => (r as { page_id: number }).page_id))); });
    };
    load();
    const channel = supabase
      .channel(`scene_gen_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "page_scene_images", filter: `book_id=eq.${bookId}` }, load)
      .subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [bookId]);

  return ids;
}
