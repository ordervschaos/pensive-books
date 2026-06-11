import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { AIActionRow } from "./AIActionRow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { transforms, readNode, saveSpine } from "@/lib/ladder";

interface SpineGeneratorProps {
  bookId: number;
  /** Reports whether a non-empty spine exists, so the ladder can enable "Approve". */
  onStatusChange?: (hasSpine: boolean) => void;
  onChanged?: () => void;
}

/**
 * G2 — the SPINE: the book's one-paragraph throughline, derived from the brief. Generate it, edit it,
 * and it becomes the contract the outline must realize (this is the step that makes the spine real —
 * the C3 gap). Persisted to books.spine via the ladder client.
 */
export function SpineGenerator({ bookId, onStatusChange, onChanged }: SpineGeneratorProps) {
  const { toast } = useToast();
  const [spine, setSpine] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const text = await readNode(bookId, "spine");
      if (!alive) return;
      setSpine(text);
      setLoaded(true);
      onStatusChange?.(!!text.trim());
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const generate = async () => {
    if (working) return;
    setWorking(true);
    try {
      const text = await transforms.briefToSpine(bookId);
      await saveSpine(bookId, text);
      setSpine(text);
      setDirty(false);
      onStatusChange?.(!!text.trim());
      onChanged?.();
    } catch (e) {
      toast({ title: "Couldn't draft the spine", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveSpine(bookId, spine.trim());
      setDirty(false);
      onStatusChange?.(!!spine.trim());
      onChanged?.();
    } catch (e) {
      toast({ title: "Couldn't save the spine", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-3">
      <AIActionRow
        icon={<Sparkles className="h-4 w-4" />}
        title={working ? <span>Drafting the spine<AnimatedEllipsis /></span> : spine.trim() ? "Re-draft the spine from the brief" : "Draft the spine from the brief"}
        description="One paragraph that names the throughline — what the book is really about. The outline is built to realize it."
        onClick={generate}
        loading={working}
      />
      {(spine.trim() || dirty) && (
        <div className="space-y-2">
          <Textarea
            value={spine}
            onChange={(e) => { setSpine(e.target.value); setDirty(true); }}
            placeholder="The book's throughline, in a paragraph…"
            rows={5}
            className="pv-serif text-[14px] leading-relaxed"
          />
          {dirty && (
            <Button size="sm" variant="outline" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save edits"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
