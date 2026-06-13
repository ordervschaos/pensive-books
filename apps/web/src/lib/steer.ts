// steer — the author's free-text "steer" for a Build-Studio step: a guidance prompt typed BEFORE
// generating, folded into that step's generation. It is STICKY per book+step — saved to
// books.steers (a small jsonb keyed by step), pre-filled on return, reused for re-generations until
// changed. The server cores read books.steers[step] and append it to their prompt (see
// supabase/functions/_shared/steer.ts), so the client only has to persist it; nothing rides in the
// generation params. Callers save() right before kicking a run so the background worker reads the
// fresh value.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SteerStep = "foundations" | "spine" | "outline" | "beats" | "prose";

type SteerBag = Partial<Record<SteerStep, string>>;

export async function readSteer(bookId: number, step: SteerStep): Promise<string> {
  const { data } = await supabase.from("books").select("steers").eq("id", bookId).maybeSingle();
  const bag = (data?.steers as SteerBag | null) ?? {};
  return (bag[step] ?? "").trim();
}

// Read-modify-write the steers jsonb (mirrors saveSpine in @/lib/ladder). A blank value drops the
// key so the bag stays clean.
export async function saveSteer(bookId: number, step: SteerStep, text: string): Promise<void> {
  const trimmed = text.trim();
  const { data } = await supabase.from("books").select("steers").eq("id", bookId).maybeSingle();
  const prev = (data?.steers as SteerBag | null) ?? {};
  const next: SteerBag = { ...prev };
  if (trimmed) next[step] = trimmed; else delete next[step];
  const { error } = await supabase.from("books").update({ steers: next }).eq("id", bookId);
  if (error) throw error;
}

export interface UseSteer {
  value: string;
  setValue: (v: string) => void;
  /** Persist the current value (only writes when it differs from what's on the server). */
  save: () => Promise<void>;
  loaded: boolean;
}

// One steer field's state: load once, edit locally, persist on demand. `save()` is what callers
// await right before generating; it no-ops when nothing changed.
export function useSteer(bookId: number, step: SteerStep, enabled = true): UseSteer {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const savedRef = useRef("");

  useEffect(() => {
    if (!enabled) { setLoaded(false); return; }
    let alive = true;
    setLoaded(false);
    void readSteer(bookId, step).then((v) => {
      if (!alive) return;
      savedRef.current = v;
      setValue(v);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [bookId, step, enabled]);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed === savedRef.current) return;
    await saveSteer(bookId, step, trimmed);
    savedRef.current = trimmed;
  }, [bookId, step, value]);

  return { value, setValue, save, loaded };
}
