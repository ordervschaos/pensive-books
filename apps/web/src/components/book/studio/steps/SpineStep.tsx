// SpineStep — the Spine step's Stage body.
//
// Chat-first redesign: the center is a plain, editable spine textarea (autosave on blur).
// Generation and options live in the right-rail ReviseChat (layer="spine"). When empty,
// a calm pointer directs the author to the chat rail.
import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { saveSpine } from "@/lib/ladder";
import { readSpineNode } from "@/lib/foundations";
import { ActionLink, GenerateInChat, Panel, Eyebrow } from "../studioUi";
import { Check } from "lucide-react";

interface Props {
  bookId: number;
  /** Bumped on every studio refresh — re-reads the spine after the editor rail applies a revision. */
  reloadKey?: number;
  onStatusChange: (v: boolean) => void;
  onChanged: () => void;
}

export function SpineStep({ bookId, reloadKey, onStatusChange, onChanged }: Props) {
  const { toast } = useToast();
  const [spine, setSpine] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const n = await readSpineNode(bookId);
    setSpine((n.text ?? "").trim());
    onStatusChange(!!(n.text ?? "").trim());
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      await reload();
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // The editor rail lives outside this column; when it applies a spine revision the studio refresh
  // bumps reloadKey, so re-read the chosen spine here. Skip while the author is mid-edit.
  useEffect(() => {
    if (!loaded || dirty) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveSpine(bookId, spine.trim(), { pinned: true });
      setDirty(false);
      onStatusChange(!!spine.trim());
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't save the spine", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  if (!spine.trim()) {
    return (
      <div className="space-y-4">
        <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
          No spine yet.
        </p>
        <GenerateInChat bookId={bookId} layer="spine" label="Draft the spine" />
        <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
          Or type it directly below — one paragraph describing the journey from your argument to your ending.
        </p>
        <Panel variant="soft" className="px-5 py-4">
          <Textarea
            value={spine}
            onChange={(e) => { setSpine(e.target.value); setDirty(true); }}
            onBlur={() => { if (dirty && spine.trim()) void save(); }}
            placeholder="The spine in one paragraph — how the story moves from argument to ending through the tentpoles…"
            rows={6}
            className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <Panel variant="chosen">
        <div className="mb-1 flex items-center justify-between">
          <Eyebrow tone="accent">
            <Check className="mr-1 inline h-3 w-3" strokeWidth={3} />Spine
          </Eyebrow>
        </div>
        <Textarea
          value={spine}
          onChange={(e) => { setSpine(e.target.value); setDirty(true); }}
          onBlur={() => { if (dirty) void save(); }}
          rows={8}
          className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
        />
        {dirty && (
          <div className="mt-3.5 flex items-center justify-end gap-4 border-t border-[hsl(var(--pv-border-soft))] pt-3.5 text-[13.5px]">
            <ActionLink tone="muted" busy={saving} onClick={() => void save()}>save edits</ActionLink>
          </div>
        )}
      </Panel>
    </div>
  );
}
