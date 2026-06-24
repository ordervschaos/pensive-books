// useBookLook — the book's image "look" (theme + art_direction + render model), live-projected from
// books.foundations: read once then subscribed, so a change from anywhere (Foundations, the Scene tab, the
// DNA studio, another tab) lands here with no refresh. `patchLook` merges a slice without clobbering
// cast/argument/etc. Shared by the Build Studio's Scene tab and the Novel-DNA picture-book look panel.
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { writeFoundationsPatch, type Foundations } from "@/lib/foundations";

export type BookLook = Pick<Foundations, "art_theme" | "art_direction" | "image_model">;

export function useBookLook(bookId: number) {
  const { toast } = useToast();
  const [look, setLook] = useState<BookLook>({});

  useEffect(() => {
    let live = true;
    const pick = (f: Foundations | null): BookLook => ({ art_theme: f?.art_theme, art_direction: f?.art_direction, image_model: f?.image_model });
    void supabase.from("books").select("foundations").eq("id", bookId).maybeSingle()
      .then(({ data }) => { if (live) setLook(pick(data?.foundations as Foundations | null)); });
    const channel = supabase
      .channel(`book_look_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${bookId}` },
        (p) => setLook(pick((p as unknown as { new: { foundations: Foundations | null } }).new.foundations)))
      .subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [bookId]);

  const patchLook = async (p: Partial<Foundations>) => {
    setLook((prev) => ({ ...prev, ...p }));
    try { await writeFoundationsPatch(bookId, p); }
    catch (e) { toast({ variant: "destructive", title: "Couldn't save the look", description: String((e as Error)?.message ?? e) }); }
  };

  return { look, patchLook };
}
