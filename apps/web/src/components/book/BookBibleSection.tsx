import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

interface BookBibleSectionProps {
  bookId: number;
  /** Current bible text (books.bible.text). */
  bible: string | null;
  onBibleChange: (text: string) => void;
}

/**
 * The book "bible" — established facts (characters, world, style) every page must stay
 * consistent with. Layer A of generation context, beyond the brief. Free-text markdown,
 * author-owned. "Draft from brief" seeds a first version with AI; the author then edits.
 */
export function BookBibleSection({ bookId, bible, onBibleChange }: BookBibleSectionProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(bible ?? "");
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const dirty = draft !== (bible ?? "");

  const save = async () => {
    try {
      setSaving(true);
      const text = draft.trim();
      const { error } = await supabase
        .from("books")
        .update({ bible: text ? { text } : null })
        .eq("id", bookId);
      if (error) throw error;
      onBibleChange(text);
      toast({ title: "Bible saved", description: "Facts the AI will keep consistent." });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save bible", description: String((e as Error)?.message ?? e) });
    } finally {
      setSaving(false);
    }
  };

  const draftFromBrief = async () => {
    if (draft.trim() && !window.confirm("Replace the current bible with an AI draft from the brief?")) return;
    try {
      setDrafting(true);
      let text: string;
      if (BRIDGE) {
        const r = await fetch(`${BRIDGE}/bible/${bookId}`, { method: "POST" });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        text = String(d.text ?? "").trim();
      } else {
        const { data, error } = await supabase.functions.invoke("generate-bible", { body: { bookId } });
        if (error) throw error;
        if (!data?.text) throw new Error(data?.error || "No text returned");
        text = String(data.text).trim();
      }
      setDraft(text); // into the editor for review; not saved until the author clicks Save
      toast({ title: "Draft ready", description: "Review and edit, then Save." });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't draft bible", description: String((e as Error)?.message ?? e) });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Book bible</h2>
          <p className="text-sm text-muted-foreground">
            Established facts — characters, world, style — the AI keeps consistent across every page.
            Only you see this.
          </p>
        </div>
        <Button onClick={draftFromBrief} disabled={drafting} variant="outline" size="sm" className="flex-none">
          {drafting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {drafting ? "Drafting…" : "Draft from brief"}
        </Button>
      </div>

      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={"## Characters\n- ...\n\n## World & Setting\n- ...\n\n## Style & Voice\n- ..."}
        className="min-h-[240px] font-mono text-sm leading-relaxed"
      />

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save bible"}
        </Button>
      </div>
    </Card>
  );
}
